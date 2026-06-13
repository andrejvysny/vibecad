import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CameraPreset } from "@shared/types";
import {
  DEFAULT_VIEWPORT_SETTINGS,
  type ViewportSettings,
} from "../../stores/viewport.store";
import {
  edgeColor,
  materialParams,
  resolveViewportBudget,
  type ViewportBudget,
} from "./viewerQuality";
import {
  disposeMaterial,
  disposeObject,
  fitShadowCamera,
  refreshSsaoCamera,
  studioEnvironment,
  updateOrthographicCamera,
} from "./viewerThree";

const BG = 0x0a0d12;
const ORBIT_SENS = 0.4;
const ORBIT_DRAG_SENS = 1.0;
const CREASE_ANGLE = (35 * Math.PI) / 180;
const DIRS: Record<CameraPreset, [number, number, number]> = {
  front: [0, -1, 0],
  top: [0, -0.0001, 1],
  iso: [1, -1, 1],
};

/** Shift line-segment positions by -center (matches the mesh's baked offset). */
function centerSegments(
  src: Float32Array,
  center: THREE.Vector3,
): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i]! - center.x;
    out[i + 1] = src[i + 1]! - center.y;
    out[i + 2] = src[i + 2]! - center.z;
  }
  return out;
}

function rotateAbout(
  v: THREE.Vector3,
  center: THREE.Vector3,
  q: THREE.Quaternion,
): void {
  v.sub(center).applyQuaternion(q).add(center);
}

type ViewerCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Encapsulates the three.js scene, lighting, controls, and render loop. */
export class Viewer {
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private renderPass!: RenderPass;
  private ssaoPass!: SSAOPass;
  private smaaPass!: SMAAPass;
  private outputPass!: OutputPass;
  private scene!: THREE.Scene;
  private perspectiveCamera!: THREE.PerspectiveCamera;
  private orthographicCamera!: THREE.OrthographicCamera;
  private camera!: ViewerCamera;
  private controls!: OrbitControls;
  private key!: THREE.DirectionalLight;

  private mesh: THREE.Mesh | null = null;
  // Offset baked into the mesh geometry (original bbox center). Pins are stored
  // in original model space, so pick/project apply this offset to convert.
  private modelCenter = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private edges: THREE.LineSegments | null = null;
  // True B-rep edge segments (already centered), when supplied by a STEP load;
  // null ⇒ infer edges from the mesh via EdgesGeometry.
  private customEdges: Float32Array | null = null;
  private grid: THREE.GridHelper | null = null;
  private readonly groundGroup = new THREE.Group();
  private shadowPlane!: THREE.Mesh;

  private settings: ViewportSettings;
  private budget: ViewportBudget;
  private viewport = { width: 1, height: 1 };
  private triangleCount = 0;
  private radius = 1;
  private orthoHalfHeight = 1;
  private raf = 0;
  private ro: ResizeObserver;
  private edgesVisible = true;
  private gridVisible = true;
  private drag: "orbit" | "pan" | null = null;
  private bounds = { x: 0, y: 0, z: 0 };
  private gridCell = 0;
  private gizmoScene = new THREE.Scene();
  private gizmoCam = new THREE.OrthographicCamera(
    -1.6,
    1.6,
    1.6,
    -1.6,
    0.1,
    10,
  );

  constructor(
    private mount: HTMLElement,
    settings: ViewportSettings = DEFAULT_VIEWPORT_SETTINGS,
  ) {
    this.settings = { ...settings };
    this.budget = resolveViewportBudget(this.settings, this.viewport, 0);
    const el = this.initRenderer();

    this.initScene();
    this.initCameras();
    this.initLighting();
    this.initControlsAndComposer(el);
    this.initEvents(el);
    this.initGizmo();

    mount.appendChild(el);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(mount);
    this.resize();
    this.loop();
  }

  private initRenderer(): HTMLCanvasElement {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      // Needed so captureCanvas() can read pixels back for annotated screenshots.
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(BG);

    const el = this.renderer.domElement;
    el.style.display = "block";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.touchAction = "none";
    return el;
  }

  private initScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.scene.environment = studioEnvironment(this.renderer);
  }

  private initCameras(): void {
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.orthographicCamera = new THREE.OrthographicCamera(
      -1,
      1,
      1,
      -1,
      0.1,
      100000,
    );
    [this.perspectiveCamera, this.orthographicCamera].forEach((cam) => {
      cam.up.set(0, 0, 1);
      cam.position.set(1, -1, 1);
    });
    this.camera =
      this.settings.projection === "orthographic"
        ? this.orthographicCamera
        : this.perspectiveCamera;
  }

  private initLighting(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));
    this.scene.add(new THREE.HemisphereLight(0xe2e9ff, 0x20262e, 0.42));
    this.key = new THREE.DirectionalLight(0xffffff, 2.1);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.00035;
    this.scene.add(this.key, this.key.target);

    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.25 }),
    );
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane, this.groundGroup);
  }

  private initControlsAndComposer(el: HTMLCanvasElement): void {
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.enableZoom = false;
    this.controls.enableRotate = false;

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.ssaoPass = new SSAOPass(this.scene, this.camera, 1, 1, 32);
    this.ssaoPass.kernelRadius = 6;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.09;
    this.smaaPass = new SMAAPass(1, 1);
    this.outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ssaoPass);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.outputPass);
  }

  private initEvents(el: HTMLCanvasElement): void {
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
  }

  private initGizmo(): void {
    const triad = new THREE.AxesHelper(1);
    (triad.material as THREE.Material).depthTest = false;
    this.gizmoScene.add(triad);
    this.gizmoCam.up.set(0, 0, 1);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.settings.controlPreset === "cad" || e.ctrlKey)
      this.dolly(e.deltaY);
    else if (e.shiftKey) this.orbit(-e.deltaX, -e.deltaY);
    else this.pan(e.deltaX, e.deltaY);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.drag = e.shiftKey ? "pan" : "orbit";
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    if (this.drag === "orbit")
      this.orbit(e.movementX, e.movementY, ORBIT_DRAG_SENS);
    else this.pan(-e.movementX, -e.movementY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.drag = null;
    const el = this.renderer.domElement;
    if (el.hasPointerCapture(e.pointerId))
      el.releasePointerCapture(e.pointerId);
  };

  private orbit(dx: number, dy: number, sens = ORBIT_SENS): void {
    const h = this.renderer.domElement.clientHeight || 1;
    const pivot = this.controls.target;
    const qAz = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (-2 * Math.PI * dx * sens) / h,
    );
    rotateAbout(this.camera.position, pivot, qAz);
    const right = new THREE.Vector3()
      .setFromMatrixColumn(this.camera.matrix, 0)
      .normalize();
    const qPitch = new THREE.Quaternion().setFromAxisAngle(
      right,
      (-2 * Math.PI * dy * sens) / h,
    );
    const tilted = this.camera.position
      .clone()
      .sub(pivot)
      .applyQuaternion(qPitch);
    const angle = tilted.angleTo(new THREE.Vector3(0, 0, 1));
    if (angle > 0.05 && angle < Math.PI - 0.05)
      rotateAbout(this.camera.position, pivot, qPitch);
    this.controls.update();
  }

  private dolly(deltaY: number): void {
    if (this.camera instanceof THREE.OrthographicCamera) {
      this.orthoHalfHeight = THREE.MathUtils.clamp(
        this.orthoHalfHeight * Math.exp(deltaY * 0.01),
        Math.max(this.radius * 0.08, 0.01),
        this.radius * 40,
      );
      this.updateOrthographicProjection();
      return;
    }
    const target = this.controls.target;
    const dist = this.camera.position.distanceTo(target);
    const newDist = THREE.MathUtils.clamp(
      dist * Math.exp(deltaY * 0.01),
      this.radius * 0.5,
      this.radius * 50,
    );
    const dir = this.camera.position.clone().sub(target).normalize();
    this.camera.position.copy(target).addScaledVector(dir, newDist);
    this.controls.update();
  }

  private pan(dx: number, dy: number): void {
    const h = this.renderer.domElement.clientHeight || 1;
    const halfView =
      this.camera instanceof THREE.PerspectiveCamera
        ? this.camera.position.distanceTo(this.controls.target) *
          Math.tan((this.camera.fov / 2) * (Math.PI / 180))
        : this.orthoHalfHeight;
    const panX = (2 * dx * halfView) / h;
    const panY = (2 * dy * halfView) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(
      this.camera.matrix,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = new THREE.Vector3()
      .addScaledVector(right, panX)
      .addScaledVector(up, -panY);
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.controls.update();
  }

  private resize(): void {
    const width = this.mount.clientWidth || 1;
    const height = this.mount.clientHeight || 1;
    this.viewport = { width, height };
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateOrthographicProjection();
    this.applyRenderBudget();
  }

  private applyRenderBudget(): void {
    const next = resolveViewportBudget(
      this.settings,
      this.viewport,
      this.triangleCount,
    );
    const edgeChanged = next.edgeThreshold !== this.budget.edgeThreshold;
    this.budget = next;
    this.renderer.setPixelRatio(next.dpr);
    this.composer.setPixelRatio(next.dpr);
    this.renderer.setSize(this.viewport.width, this.viewport.height, false);
    this.composer.setSize(this.viewport.width, this.viewport.height);
    this.ssaoPass.enabled = next.ao;
    this.setShadowMapSize(next.shadowMapSize);
    if (edgeChanged) this.rebuildEdges();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.composer.render();
    this.renderGizmo();
  };

  private renderGizmo(): void {
    const size = 64;
    const pad = 10;
    const w = this.viewport.width;
    const h = this.viewport.height;
    const dir = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this.gizmoCam.position.copy(dir.multiplyScalar(4));
    this.gizmoCam.up.copy(this.camera.up);
    this.gizmoCam.lookAt(0, 0, 0);

    this.renderer.clearDepth();
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(w - size - pad, pad, size, size);
    this.renderer.setViewport(w - size - pad, pad, size, size);
    this.renderer.render(this.gizmoScene, this.gizmoCam);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
  }

  setSettings(settings: ViewportSettings): void {
    const projectionChanged = settings.projection !== this.settings.projection;
    this.settings = { ...settings };
    if (projectionChanged) this.switchCamera();
    this.applyMaterial();
    this.applyRenderBudget();
  }

  setGeometry(
    geometry: THREE.BufferGeometry,
    {
      resetCamera = true,
      edges,
    }: { resetCamera?: boolean; edges?: Float32Array | null } = {},
  ): void {
    this.clear();
    const shaded = toCreasedNormals(geometry, CREASE_ANGLE);
    if (shaded !== geometry) geometry.dispose();
    shaded.computeBoundingBox();
    const box = shaded.boundingBox ?? new THREE.Box3();
    const center = box.getCenter(new THREE.Vector3());
    this.modelCenter.copy(center);
    const size = box.getSize(new THREE.Vector3());
    const position = shaded.getAttribute("position");
    this.triangleCount = position ? Math.floor(position.count / 3) : 0;
    this.bounds = { x: size.x, y: size.y, z: size.z };
    // Center supplied edges by the same offset baked into the mesh geometry.
    this.customEdges = edges ? centerSegments(edges, center) : null;
    shaded.translate(-center.x, -center.y, -center.z);
    shaded.computeBoundingSphere();
    this.radius = Math.max(
      shaded.boundingSphere?.radius ?? size.length() / 2,
      1,
    );

    this.mesh = new THREE.Mesh(
      shaded,
      new THREE.MeshStandardMaterial(
        materialParams(this.settings.materialPreset),
      ),
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    this.rebuildEdges();
    this.layoutGround(-size.z / 2, Math.max(size.x, size.y));
    this.placeKeyLight();
    this.fitClipping();
    this.applyRenderBudget();
    if (resetCamera) this.setCamera("iso");
  }

  private rebuildEdges(): void {
    if (!this.mesh) return;
    if (this.edges) {
      this.mesh.remove(this.edges);
      disposeObject(this.edges);
    }
    // Prefer true B-rep edges (STEP); otherwise infer from the mesh geometry.
    let edgeGeometry: THREE.BufferGeometry;
    if (this.customEdges) {
      edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(this.customEdges, 3),
      );
    } else {
      edgeGeometry = new THREE.EdgesGeometry(
        this.mesh.geometry,
        this.budget.edgeThreshold,
      );
    }
    this.edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: edgeColor(this.settings.materialPreset),
        transparent: true,
        opacity: 0.82,
      }),
    );
    this.edges.visible = this.edgesVisible;
    this.mesh.add(this.edges);
  }

  private applyMaterial(): void {
    if (this.mesh?.material instanceof THREE.MeshStandardMaterial) {
      this.mesh.material.setValues(
        materialParams(this.settings.materialPreset),
      );
      this.mesh.material.needsUpdate = true;
    }
    if (this.edges?.material instanceof THREE.LineBasicMaterial)
      this.edges.material.color.setHex(edgeColor(this.settings.materialPreset));
  }

  private layoutGround(baseZ: number, footprint: number): void {
    disposeObject(this.groundGroup);
    this.groundGroup.clear();
    const span = Math.max(footprint * 3, this.radius * 4);
    const divisions = 20;
    this.gridCell = span / divisions;
    this.grid = new THREE.GridHelper(span, divisions, 0x627690, 0x33404f);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = baseZ;
    this.groundGroup.add(this.grid);

    const axes = new THREE.AxesHelper(this.radius * 0.6);
    axes.position.z = baseZ;
    this.groundGroup.add(axes);
    this.groundGroup.visible = this.gridVisible;

    this.shadowPlane.geometry.dispose();
    this.shadowPlane.geometry = new THREE.PlaneGeometry(span, span);
    this.shadowPlane.position.z = baseZ - 0.01;
  }

  private placeKeyLight(): void {
    const r = this.radius;
    this.key.position.set(r * 1.5, -r * 2, r * 3);
    this.key.target.position.set(0, 0, 0);
    fitShadowCamera(this.key, r);
  }

  private setShadowMapSize(size: number): void {
    if (this.key.shadow.mapSize.x === size) return;
    this.key.shadow.mapSize.set(size, size);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
  }

  private fitClipping(): void {
    const near = Math.max(this.radius / 100, 0.01);
    const far = this.radius * 100;
    [this.perspectiveCamera, this.orthographicCamera].forEach((cam) => {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    });
    this.refreshSsaoCamera();
  }

  private refreshSsaoCamera(): void {
    refreshSsaoCamera(this.renderPass, this.ssaoPass, this.camera);
  }

  private updateOrthographicProjection(): void {
    updateOrthographicCamera(
      this.orthographicCamera,
      this.orthoHalfHeight,
      this.viewport,
    );
    if (this.camera === this.orthographicCamera) this.refreshSsaoCamera();
  }

  private switchCamera(): void {
    const previous = this.camera;
    const next =
      this.settings.projection === "orthographic"
        ? this.orthographicCamera
        : this.perspectiveCamera;
    if (next === previous) return;
    next.position.copy(previous.position);
    next.quaternion.copy(previous.quaternion);
    next.up.copy(previous.up);
    if (previous instanceof THREE.PerspectiveCamera) {
      const dist = previous.position.distanceTo(this.controls.target);
      this.orthoHalfHeight = Math.max(
        dist * Math.tan((previous.fov * Math.PI) / 360),
        this.radius * 0.2,
      );
    }
    this.camera = next;
    this.controls.object = next;
    this.updateOrthographicProjection();
    this.refreshSsaoCamera();
    this.controls.update();
  }

  setCamera(preset: CameraPreset): void {
    const fov = (this.perspectiveCamera.fov * Math.PI) / 180;
    const d = (this.radius / Math.sin(fov / 2)) * 1.15;
    const [x, y, z] = DIRS[preset];
    const len = Math.hypot(x, y, z) || 1;
    this.camera.position.set((x / len) * d, (y / len) * d, (z / len) * d);
    this.controls.target.set(0, 0, 0);
    this.orthoHalfHeight = this.radius * 1.3;
    this.updateOrthographicProjection();
    this.controls.update();
  }

  setEdgesVisible(visible: boolean): void {
    this.edgesVisible = visible;
    if (this.edges) this.edges.visible = visible;
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.groundGroup.visible = visible;
  }

  getBounds(): { x: number; y: number; z: number } {
    return { ...this.bounds };
  }

  getGridCell(): number {
    return this.gridCell;
  }

  // ── Annotation helpers (manual 3D feedback) ────────────────────────────────

  getModelCenter(): THREE.Vector3 {
    return this.modelCenter.clone();
  }

  /** Raycast a viewport pixel against the mesh; returns the hit point in
   *  original model space (mm), or null if the ray missed / no mesh. */
  pickPoint(
    clientX: number,
    clientY: number,
  ): { world: [number, number, number] } | null {
    if (!this.mesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    const w = hit.point.add(this.modelCenter);
    return { world: [w.x, w.y, w.z] };
  }

  /** Project a model-space point to canvas CSS pixels (overlay coordinates). */
  project(world: [number, number, number]): {
    x: number;
    y: number;
    visible: boolean;
  } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(world[0], world[1], world[2])
      .sub(this.modelCenter)
      .project(this.camera);
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
      visible: v.z < 1,
    };
  }

  /** Render the scene once and read the canvas back as a PNG data URL. */
  captureCanvas(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  clear(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    disposeObject(this.mesh);
    this.mesh = null;
    this.edges = null;
    this.customEdges = null;
    this.triangleCount = 0;
    this.applyRenderBudget();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    this.clear();
    disposeObject(this.groundGroup);
    disposeObject(this.gizmoScene);
    this.shadowPlane.geometry.dispose();
    disposeMaterial(this.shadowPlane.material);
    this.scene.environment?.dispose();
    this.ssaoPass.dispose();
    this.smaaPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
