import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CameraPreset } from "@shared/types";

const BG = 0x0a0d12;

// Z-up camera directions per preset (OpenSCAD exports Z-up STL). Scaled to the
// model's bounding sphere. `top` carries a tiny Y offset to dodge the up-vector
// singularity when looking straight down +Z.
const DIRS: Record<CameraPreset, [number, number, number]> = {
  front: [0, -1, 0],
  top: [0, -0.0001, 1],
  iso: [1, -1, 1],
};

/** Rotate `v` about `center` by quaternion `q`, in place. */
function rotateAbout(
  v: THREE.Vector3,
  center: THREE.Vector3,
  q: THREE.Quaternion,
): void {
  v.sub(center).applyQuaternion(q).add(center);
}

/** Encapsulates the three.js scene, lighting, controls, and render loop. */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private key: THREE.DirectionalLight;

  private mesh: THREE.Mesh | null = null;
  private edges: THREE.LineSegments | null = null;
  private grid: THREE.GridHelper | null = null;
  private readonly groundGroup = new THREE.Group();
  private shadowPlane: THREE.Mesh;

  private radius = 1;
  private raf = 0;
  private ro: ResizeObserver;
  private edgesVisible = true;
  private gridVisible = true;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  // Model footprint (world units) + grid cell size, surfaced to the HUD overlay.
  private bounds = { x: 0, y: 0, z: 0 };
  private gridCell = 0;

  // Corner orientation gizmo (colored axis triad) rendered as a second pass.
  private gizmoScene = new THREE.Scene();
  private gizmoCam = new THREE.OrthographicCamera(
    -1.6,
    1.6,
    1.6,
    -1.6,
    0.1,
    10,
  );

  constructor(private mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);

    // Soft studio IBL — the main reason faces read with gradient instead of flat.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmrem.dispose();

    // Z-up to match OpenSCAD.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1, -1, 1);

    // IBL does the heavy lifting; lights add contrast + the contact shadow.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    this.scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x20262e, 0.35));
    this.key = new THREE.DirectionalLight(0xffffff, 2.0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    // Ground: contact-shadow catcher + grid + axes (grouped so Grid toggle hides all).
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);
    this.scene.add(this.groundGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enableZoom = false; // wheel handled manually (onWheel)
    this.controls.enableRotate = false; // left-drag handled manually (onPointer*)

    const el = this.renderer.domElement;
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);

    // Orientation gizmo: colored triad (R=X, G=Y, B=Z), Z-up like the scene.
    const triad = new THREE.AxesHelper(1);
    (triad.material as THREE.Material).depthTest = false;
    this.gizmoScene.add(triad);
    this.gizmoCam.up.set(0, 0, 1);

    mount.appendChild(this.renderer.domElement);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(mount);
    this.resize();
    this.loop();
  }

  // ── Trackpad: pinch (ctrlKey) zooms, two-finger scroll pans ──────────────
  // Chromium/Electron encode a trackpad pinch as a wheel event with
  // ctrlKey=true; a plain two-finger scroll arrives with ctrlKey=false.
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey) this.dolly(e);
    else this.pan(e.deltaX, e.deltaY);
  };

  // ── Left-drag orbit, pivoting around the MODEL CENTER (origin) ───────────
  // We rotate the whole camera rig (position + look-target) about the origin,
  // so orbit always spins the object about its own center even after pan or
  // cursor-zoom have offset the look-target. (OrbitControls' built-in rotate
  // pivots around its target, which drifts — hence enableRotate=false.)
  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.orbit(dx, dy);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    }
  };

  /** Rotate camera + target about the origin: azimuth about world-up (Z),
   *  pitch about the camera's right axis, clamped to avoid pole flips. */
  private orbit(dx: number, dy: number): void {
    const h = this.renderer.domElement.clientHeight || 1;
    const origin = new THREE.Vector3(0, 0, 0);

    const qAz = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (-2 * Math.PI * dx) / h,
    );
    rotateAbout(this.camera.position, origin, qAz);
    rotateAbout(this.controls.target, origin, qAz);

    const right = new THREE.Vector3()
      .setFromMatrixColumn(this.camera.matrix, 0)
      .normalize();
    const qPitch = new THREE.Quaternion().setFromAxisAngle(
      right,
      (-2 * Math.PI * dy) / h,
    );
    // Skip the pitch if it would push the view past the up/down poles.
    const tilted = this.camera.position.clone().applyQuaternion(qPitch);
    const angle = tilted.angleTo(new THREE.Vector3(0, 0, 1));
    if (angle > 0.05 && angle < Math.PI - 0.05) {
      rotateAbout(this.camera.position, origin, qPitch);
      rotateAbout(this.controls.target, origin, qPitch);
    }
    this.controls.update();
  }

  // Cursor-centered dolly: keep the world point under the pointer fixed by
  // scaling the camera + target about it (lerp both toward the pivot).
  private dolly(e: WheelEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const target = this.controls.target;
    const dist = this.camera.position.distanceTo(target);
    const newDist = THREE.MathUtils.clamp(
      dist * Math.exp(e.deltaY * 0.01), // spread (deltaY<0) → closer
      this.radius * 0.5,
      this.radius * 50,
    );
    if (newDist === dist) return;

    // Point under the cursor on the plane through the target, ⊥ to the view.
    const dir = new THREE.Vector3(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();
    const viewDir = target.clone().sub(this.camera.position).normalize();
    const denom = dir.dot(viewDir);
    const pivot =
      Math.abs(denom) > 1e-6
        ? this.camera.position.clone().addScaledVector(dir, dist / denom)
        : target.clone();

    const f = 1 - newDist / dist; // scale everything about `pivot`
    this.camera.position.lerp(pivot, f);
    target.lerp(pivot, f);
    // Keep the look-target within the model so cursor-zoom can't drift the
    // framing away from the object (orbit still pivots about the origin).
    if (target.length() > this.radius) target.setLength(this.radius);
    this.controls.update();
  }

  private pan(dx: number, dy: number): void {
    const h = this.renderer.domElement.clientHeight || 1;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const td =
      offset.length() * Math.tan((this.camera.fov / 2) * (Math.PI / 180));
    const panX = (2 * dx * td) / h;
    const panY = (2 * dy * td) / h;
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
    const w = this.mount.clientWidth || 1;
    const h = this.mount.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.renderGizmo();
  };

  /** Draw the orientation triad in the bottom-right corner (second pass). */
  private renderGizmo(): void {
    const size = 64;
    const pad = 10;
    const w = this.mount.clientWidth || 1;
    const r = this.renderer;

    // Look at the origin from the same direction as the main camera.
    const dir = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this.gizmoCam.position.copy(dir.multiplyScalar(4));
    this.gizmoCam.up.copy(this.camera.up);
    this.gizmoCam.lookAt(0, 0, 0);

    r.clearDepth();
    r.setScissorTest(true);
    r.setScissor(w - size - pad, pad, size, size);
    r.setViewport(w - size - pad, pad, size, size);
    r.render(this.gizmoScene, this.gizmoCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, this.mount.clientHeight || 1);
  }

  // `resetCamera` re-frames the model (use when loading a *different* model).
  // Pass false on re-render of the same model (param tweak / Re-render) so the
  // user's current camera angle and zoom are preserved.
  setGeometry(
    geometry: THREE.BufferGeometry,
    { resetCamera = true }: { resetCamera?: boolean } = {},
  ): void {
    this.clear();
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.bounds = { x: size.x, y: size.y, z: size.z };
    this.radius = Math.max(
      geometry.boundingSphere?.radius ?? 0,
      size.length() / 2,
      1,
    );

    // Center on origin so presets and orbit target are stable.
    geometry.translate(-center.x, -center.y, -center.z);
    const halfH = size.z / 2; // model sits with its base at z = -halfH

    const material = new THREE.MeshStandardMaterial({
      color: 0x9bb4d4,
      metalness: 0.0,
      roughness: 0.55,
      side: THREE.DoubleSide, // show interior walls of open/hollow models
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);

    // Hard-edge overlay (child of mesh → shares transform).
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 30),
      new THREE.LineBasicMaterial({ color: 0x33415c }),
    );
    this.edges.visible = this.edgesVisible;
    this.mesh.add(this.edges);

    this.layoutGround(-halfH, Math.max(size.x, size.y));
    this.placeKeyLight();
    this.fitClipping();
    if (resetCamera) this.setCamera("iso");
  }

  /** Rebuild grid/axes/shadow-plane sized to the model, sitting at its base. */
  private layoutGround(baseZ: number, footprint: number): void {
    this.groundGroup.clear();
    this.grid?.dispose();

    const span = Math.max(footprint * 3, this.radius * 4);
    const divisions = 20;
    this.gridCell = span / divisions;
    this.grid = new THREE.GridHelper(span, divisions, 0x5a6e8c, 0x33404f);
    this.grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default → XY for Z-up
    this.grid.position.z = baseZ;
    this.groundGroup.add(this.grid);

    const axes = new THREE.AxesHelper(this.radius * 0.6);
    axes.position.z = baseZ;
    this.groundGroup.add(axes);
    this.groundGroup.visible = this.gridVisible;

    this.shadowPlane.geometry.dispose();
    this.shadowPlane.geometry = new THREE.PlaneGeometry(span, span);
    this.shadowPlane.position.z = baseZ - 0.01; // just under the grid
  }

  private placeKeyLight(): void {
    const r = this.radius;
    this.key.position.set(r * 1.5, -r * 2, r * 3);
    this.key.target.position.set(0, 0, 0);
    const cam = this.key.shadow.camera;
    cam.left = -r * 2;
    cam.right = r * 2;
    cam.top = r * 2;
    cam.bottom = -r * 2;
    cam.near = r * 0.5;
    cam.far = r * 12;
    cam.updateProjectionMatrix();
  }

  private fitClipping(): void {
    this.camera.near = Math.max(this.radius / 100, 0.01);
    this.camera.far = this.radius * 100;
    this.camera.updateProjectionMatrix();
  }

  setCamera(preset: CameraPreset): void {
    // Frame the bounding sphere for the current FOV with a small margin.
    const fov = (this.camera.fov * Math.PI) / 180;
    const d = (this.radius / Math.sin(fov / 2)) * 1.15;
    const [x, y, z] = DIRS[preset];
    const len = Math.hypot(x, y, z) || 1;
    this.camera.position.set((x / len) * d, (y / len) * d, (z / len) * d);
    this.controls.target.set(0, 0, 0);
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

  /** Model footprint (world units) for the dimension HUD. */
  getBounds(): { x: number; y: number; z: number } {
    return { ...this.bounds };
  }

  /** Grid cell size (world units) for the scale HUD. */
  getGridCell(): number {
    return this.gridCell;
  }

  clear(): void {
    if (!this.mesh) return;
    if (this.edges) {
      this.edges.geometry.dispose();
      (this.edges.material as THREE.Material).dispose();
      this.edges = null;
    }
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
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
    this.gizmoScene.traverse((o) => {
      if (o instanceof THREE.AxesHelper) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.grid?.dispose();
    this.shadowPlane.geometry.dispose();
    (this.shadowPlane.material as THREE.Material).dispose();
    this.scene.environment?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
