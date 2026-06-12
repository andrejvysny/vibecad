import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useBackendStore } from "../../stores/backend.store";
import { useProjectStore } from "../../stores/project.store";
import { useViewStore } from "../../stores/view.store";
import { studioUrl } from "../../lib/studio";
import type { Project } from "../../stores/project.store";
import type { CameraPreset, ExportFormat } from "@shared/types";

const CAMERAS: CameraPreset[] = ["front", "top", "iso"];

// Unit camera directions per preset; scaled to the model's bounding sphere.
const DIRS: Record<CameraPreset, [number, number, number]> = {
  front: [0, 0, 1],
  top: [0, 1, 0.0001],
  iso: [1, 0.8, 1],
};

interface Props {
  project: Project | null;
}

export function Preview({ project }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(true);

  const backends = useBackendStore((s) => s.detected);
  const backend = backends.find((b) => b.id === project?.modelingBackend);
  const meshVersion = useProjectStore((s) => s.meshVersion);

  const stlPath =
    project && project.activeModel
      ? `${project.dir}/${project.activeModel}.stl`
      : null;
  const hasStl = !!(
    project &&
    project.activeModel &&
    project.files.includes(`${project.activeModel}.stl`)
  );

  // Set up the three.js scene once.
  useEffect(() => {
    if (!mountRef.current) return;
    const viewer = new Viewer(mountRef.current);
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  // Load the active model's STL whenever it changes (or is re-exported).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!stlPath || !hasStl) {
      viewer.clear();
      setEmpty(true);
      return;
    }
    let cancelled = false;
    setError(null);
    fetch(studioUrl(stlPath))
      .then((r) => {
        if (!r.ok) throw new Error(`load failed (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        viewer.setGeometry(new STLLoader().parse(buf));
        setEmpty(false);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [stlPath, hasStl, meshVersion]);

  async function handleRender() {
    if (!project) return;
    setRendering(true);
    setError(null);
    try {
      await window.api.previewMesh({ projectId: project.id });
      useProjectStore.getState().bumpMesh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    if (!project || !project.activeModel) return;
    const sourceExt = project.modelingBackend === "openscad" ? "scad" : "py";
    const modelPath = `${project.dir}/${project.activeModel}.${sourceExt}`;
    setError(null);
    try {
      await window.api.exportModel({ modelPath, format });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
        <button
          onClick={() => useViewStore.getState().show3d()}
          className="px-3 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-100"
        >
          3D
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        {CAMERAS.map((cam) => (
          <button
            key={cam}
            onClick={() => viewerRef.current?.setCamera(cam)}
            className="px-3 py-0.5 rounded text-xs font-medium text-gray-400 hover:text-gray-200"
          >
            {cam.charAt(0).toUpperCase() + cam.slice(1)}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => void handleRender()}
          disabled={rendering || !project}
          className="px-2 py-0.5 text-xs border border-white/10 rounded text-gray-400 hover:border-white/30 hover:text-gray-200 disabled:opacity-40"
        >
          {rendering ? "Rendering…" : "Re-render"}
        </button>
        {backend?.exports.map((fmt) => (
          <button
            key={fmt}
            onClick={() => void handleExport(fmt)}
            className="px-2 py-0.5 text-xs border border-white/10 rounded text-gray-400 hover:border-white/30 hover:text-gray-200"
          >
            {fmt.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Viewport */}
      <div className="flex-1 relative bg-[#0a0d12] overflow-hidden">
        <div ref={mountRef} className="absolute inset-0" />
        {(empty || error) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {error ? (
              <p className="text-red-400 text-sm max-w-md text-center px-4 whitespace-pre-wrap">
                {error}
              </p>
            ) : backend && !backend.available ? (
              <p className="text-amber-400 text-sm text-center px-4">
                {backend.name} not available
                {backend.missing
                  ? ` (missing: ${backend.missing.join(", ")})`
                  : ""}
              </p>
            ) : (
              <p className="text-gray-600 text-sm">
                {project ? "No model yet" : "Open or create a project"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Encapsulates the three.js scene, controls, and render loop. */
class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private radius = 1;
  private raf = 0;
  private ro: ResizeObserver;

  constructor(private mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d12);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(1, 0.8, 1);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(1, 1, 1);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-1, -0.5, -1);
    this.scene.add(fill);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    mount.appendChild(this.renderer.domElement);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(mount);
    this.resize();
    this.loop();
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
  };

  setGeometry(geometry: THREE.BufferGeometry): void {
    this.clear();
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    const center = sphere?.center ?? new THREE.Vector3();
    this.radius = sphere?.radius || 1;
    geometry.translate(-center.x, -center.y, -center.z);

    const material = new THREE.MeshStandardMaterial({
      color: 0x9bb4d4,
      metalness: 0.1,
      roughness: 0.6,
      flatShading: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);
    this.setCamera("iso");
  }

  setCamera(preset: CameraPreset): void {
    const d = this.radius * 3;
    const [x, y, z] = DIRS[preset];
    const len = Math.hypot(x, y, z) || 1;
    this.camera.position.set((x / len) * d, (y / len) * d, (z / len) * d);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  clear(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
