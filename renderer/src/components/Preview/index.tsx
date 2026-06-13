import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { useBackendStore } from "../../stores/backend.store";
import { useProjectStore } from "../../stores/project.store";
import { useAgentStore } from "../../stores/agent.store";
import { useViewStore } from "../../stores/view.store";
import { useViewportStore } from "../../stores/viewport.store";
import { studioUrl } from "../../lib/studio";
import { loadStepGeometry, StepViewerInitError } from "../../lib/loadStep";
import { ActionButton, Divider, ToolbarButton } from "../ui";
import { ParamPanel } from "./ParamPanel";
import { Viewer } from "./viewer";
import type { Project } from "../../stores/project.store";
import type { CameraPreset, ExportFormat } from "@shared/types";
import type {
  ViewportControlPreset,
  ViewportMaterialPreset,
  ViewportProjection,
  ViewportQuality,
} from "../../stores/viewport.store";

const CAMERAS: CameraPreset[] = ["front", "top", "iso"];
const QUALITY_OPTIONS: { value: ViewportQuality; label: string }[] = [
  { value: "adaptive", label: "Adaptive" },
  { value: "max", label: "Max" },
  { value: "performance", label: "Perf" },
];
const CONTROL_OPTIONS: { value: ViewportControlPreset; label: string }[] = [
  { value: "cad", label: "CAD" },
  { value: "trackpad", label: "Trackpad" },
];
const PROJECTION_OPTIONS: { value: ViewportProjection; label: string }[] = [
  { value: "perspective", label: "Persp" },
  { value: "orthographic", label: "Ortho" },
];
const MATERIAL_OPTIONS: { value: ViewportMaterialPreset; label: string }[] = [
  { value: "cad-blue", label: "Blue" },
  { value: "studio-gray", label: "Gray" },
];

/** Trim a measurement to ≤2 decimals without trailing zeros. */
function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

type MeshFormat = "stl" | "step";
// Pick the displayable mesh for the active model. build123d projects prefer the
// precise STEP (rendered directly via OCCT); OpenSCAD prefers STL. Either falls
// back to the other format when only one is present (e.g. imported files).
function resolveMesh(
  project: Project | null,
): { path: string; format: MeshFormat } | null {
  if (!project?.activeModel) return null;
  const base = project.activeModel;
  const order: readonly MeshFormat[] =
    project.modelingBackend === "build123d" ? ["step", "stl"] : ["stl", "step"];
  for (const format of order) {
    if (project.files.includes(`${base}.${format}`)) {
      return { path: `${project.dir}/${base}.${format}`, format };
    }
  }
  return null;
}

interface Props {
  project: Project | null;
}

export function Preview({ project }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [rendering, setRendering] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [dims, setDims] = useState<{ x: number; y: number; z: number } | null>(
    null,
  );
  const [gridCell, setGridCell] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Track which model the viewer currently holds, so a re-render of the SAME
  // model (param tweak / Re-render) preserves the camera instead of re-framing.
  const loadedPathRef = useRef<string | null>(null);

  const backends = useBackendStore((s) => s.detected);
  const backend = backends.find((b) => b.id === project?.modelingBackend);
  const meshVersion = useProjectStore((s) => s.meshVersion);
  const agentRunning = useAgentStore((s) => s.running);
  const quality = useViewportStore((s) => s.quality);
  const controlPreset = useViewportStore((s) => s.controlPreset);
  const projection = useViewportStore((s) => s.projection);
  const materialPreset = useViewportStore((s) => s.materialPreset);
  const aoEnabled = useViewportStore((s) => s.aoEnabled);
  const setQuality = useViewportStore((s) => s.setQuality);
  const setControlPreset = useViewportStore((s) => s.setControlPreset);
  const setProjection = useViewportStore((s) => s.setProjection);
  const setMaterialPreset = useViewportStore((s) => s.setMaterialPreset);
  const setAoEnabled = useViewportStore((s) => s.setAoEnabled);

  const mesh = resolveMesh(project);
  const meshPath = mesh?.path ?? null;
  const meshFormat = mesh?.format ?? null;

  // Set up the three.js scene once.
  useEffect(() => {
    if (!mountRef.current) return;
    const initial = useViewportStore.getState();
    const viewer = new Viewer(mountRef.current, {
      quality: initial.quality,
      controlPreset: initial.controlPreset,
      projection: initial.projection,
      materialPreset: initial.materialPreset,
      aoEnabled: initial.aoEnabled,
    });
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewerRef.current?.setSettings({
      quality,
      controlPreset,
      projection,
      materialPreset,
      aoEnabled,
    });
  }, [quality, controlPreset, projection, materialPreset, aoEnabled]);

  // Load the active model's mesh whenever it changes (or is re-exported).
  // STL parses synchronously; STEP is tessellated via the OpenCascade WASM kernel.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!meshPath || !meshFormat) {
      viewer.clear();
      loadedPathRef.current = null;
      setEmpty(true);
      setDims(null);
      return;
    }
    let cancelled = false;
    setError(null);
    // Re-frame only when switching to a different model; keep the view on
    // re-renders of the current one.
    const resetCamera = loadedPathRef.current !== meshPath;
    const isStep = meshFormat === "step";

    const apply = (
      geometry: THREE.BufferGeometry,
      edges: Float32Array | null,
    ) => {
      if (cancelled) return;
      viewer.setGeometry(geometry, { resetCamera, edges });
      loadedPathRef.current = meshPath;
      setEmpty(false);
      setDims(viewer.getBounds());
      setGridCell(viewer.getGridCell());
    };
    const fetchBuf = (url: string): Promise<ArrayBuffer> =>
      fetch(studioUrl(url)).then((r) => {
        if (!r.ok) throw new Error(`load failed (${r.status})`);
        return r.arrayBuffer();
      });

    const run = async (): Promise<void> => {
      if (isStep) setConverting(true);
      try {
        const buf = await fetchBuf(meshPath);
        if (!isStep) return apply(new STLLoader().parse(buf), null);
        try {
          const { geometry, edges } = await loadStepGeometry(buf);
          apply(geometry, edges);
        } catch (e) {
          if (!(e instanceof StepViewerInitError)) throw e;
          // OCCT kernel unavailable → fall back to the always-present STL.
          const stlBuf = await fetchBuf(meshPath.replace(/\.step$/i, ".stl"));
          apply(new STLLoader().parse(stlBuf), null);
          if (!cancelled) setToast("STEP viewer unavailable — showing STL");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled && isStep) setConverting(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [meshPath, meshFormat, meshVersion]);

  useEffect(() => {
    viewerRef.current?.setEdgesVisible(showEdges);
  }, [showEdges]);

  useEffect(() => {
    viewerRef.current?.setGridVisible(showGrid);
  }, [showGrid]);

  // Auto-dismiss the export toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleRender() {
    if (!project) return;
    setRendering(true);
    setError(null);
    try {
      await window.api.previewMesh({ projectId: project.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    setExportOpen(false);
    if (!project || !project.activeModel) return;
    const sourceExt = project.modelingBackend === "openscad" ? "scad" : "py";
    const modelPath = `${project.dir}/${project.activeModel}.${sourceExt}`;
    setError(null);
    try {
      const out = await window.api.exportModel({ modelPath, format });
      setToast(`Saved ${out.slice(out.lastIndexOf("/") + 1)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = rendering || agentRunning || converting;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
        <ToolbarButton active onClick={() => useViewStore.getState().show3d()}>
          3D
        </ToolbarButton>
        <Divider />
        {CAMERAS.map((cam) => (
          <ToolbarButton
            key={cam}
            onClick={() => viewerRef.current?.setCamera(cam)}
          >
            {cam.charAt(0).toUpperCase() + cam.slice(1)}
          </ToolbarButton>
        ))}
        <Divider />
        <ToolbarButton
          active={showEdges}
          onClick={() => setShowEdges((v) => !v)}
        >
          Edges
        </ToolbarButton>
        <ToolbarButton active={showGrid} onClick={() => setShowGrid((v) => !v)}>
          Grid
        </ToolbarButton>
        <div className="relative">
          <ToolbarButton
            active={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            View ▾
          </ToolbarButton>
          {settingsOpen && (
            <div className="absolute left-0 mt-1 z-20 w-64 rounded-md border border-white/10 bg-[#161a22] shadow-xl p-2">
              <SettingsRow label="Quality">
                {QUALITY_OPTIONS.map((opt) => (
                  <MenuOption
                    key={opt.value}
                    active={quality === opt.value}
                    onClick={() => setQuality(opt.value)}
                  >
                    {opt.label}
                  </MenuOption>
                ))}
              </SettingsRow>
              <SettingsRow label="Controls">
                {CONTROL_OPTIONS.map((opt) => (
                  <MenuOption
                    key={opt.value}
                    active={controlPreset === opt.value}
                    onClick={() => setControlPreset(opt.value)}
                  >
                    {opt.label}
                  </MenuOption>
                ))}
              </SettingsRow>
              <SettingsRow label="Projection">
                {PROJECTION_OPTIONS.map((opt) => (
                  <MenuOption
                    key={opt.value}
                    active={projection === opt.value}
                    onClick={() => setProjection(opt.value)}
                  >
                    {opt.label}
                  </MenuOption>
                ))}
              </SettingsRow>
              <SettingsRow label="Material">
                {MATERIAL_OPTIONS.map((opt) => (
                  <MenuOption
                    key={opt.value}
                    active={materialPreset === opt.value}
                    onClick={() => setMaterialPreset(opt.value)}
                  >
                    {opt.label}
                  </MenuOption>
                ))}
              </SettingsRow>
              <label className="mt-1 flex items-center justify-between gap-3 px-1 py-1 text-xs text-gray-300">
                <span>Ambient occlusion</span>
                <input
                  type="checkbox"
                  checked={aoEnabled}
                  onChange={(e) => setAoEnabled(e.currentTarget.checked)}
                  className="accent-blue-400"
                />
              </label>
            </div>
          )}
        </div>
        <div className="flex-1" />
        <ActionButton
          onClick={() => void handleRender()}
          disabled={rendering || !project}
        >
          {rendering ? "Rendering…" : "Re-render"}
        </ActionButton>
        {backend && backend.exports.length > 0 && (
          <div className="relative">
            <ActionButton
              onClick={() => setExportOpen((v) => !v)}
              disabled={!project?.activeModel}
            >
              Export ▾
            </ActionButton>
            {exportOpen && (
              <div className="absolute right-0 mt-1 z-10 min-w-[8rem] rounded-md border border-white/10 bg-[#161a22] shadow-xl py-1">
                {backend.exports.map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => void handleExport(fmt)}
                    className="flex items-center gap-2 w-full px-3 py-1 text-xs text-gray-300 hover:bg-white/10"
                  >
                    <DownloadIcon />
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Viewport */}
      <div className="flex-1 relative bg-[#0a0d12] overflow-hidden">
        <div ref={mountRef} className="absolute inset-0" />

        {project && <ParamPanel project={project} />}

        {/* Dimension / scale HUD */}
        {!empty && dims && (
          <div className="absolute top-3 right-3 text-right pointer-events-none select-none">
            <div className="text-xs text-gray-300 tabular-nums">
              {fmt(dims.x)} × {fmt(dims.y)} × {fmt(dims.z)} mm
            </div>
            {gridCell > 0 && (
              <div className="text-[10px] text-gray-500">
                grid {fmt(gridCell)} mm
              </div>
            )}
          </div>
        )}

        {/* Busy overlay */}
        {busy && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/50 border border-white/10 text-xs text-gray-300">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            {rendering
              ? "Rendering…"
              : converting
                ? "Converting STEP…"
                : "Working…"}
          </div>
        )}

        {/* Export toast */}
        {toast && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/30 text-xs text-green-300">
            {toast} ✓
          </div>
        )}

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

function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

function MenuOption({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
        active
          ? "bg-white/10 text-gray-100"
          : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="text-gray-500"
    >
      <path
        d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
