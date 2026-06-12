import { useState } from "react";
import { useBackendStore } from "../../stores/backend.store";
import type { Project } from "../../stores/project.store";
import type { CameraPreset, ExportFormat } from "@shared/types";

const CAMERAS: CameraPreset[] = ["front", "top", "iso"];

interface Props {
  project: Project | null;
}

export function Preview({ project }: Props) {
  const [activeCamera, setActiveCamera] = useState<CameraPreset>("iso");
  const [rendering, setRendering] = useState(false);
  const backends = useBackendStore((s) => s.detected);

  const backend = backends.find((b) => b.id === project?.modelingBackend);
  const pngPath = project?.previews[activeCamera];

  function latestModelPath(): string | null {
    const latest = project?.files
      .filter((f) =>
        f.endsWith(project.modelingBackend === "openscad" ? ".scad" : ".py"),
      )
      .sort()
      .at(-1);
    return project && latest ? `${project.dir}/${latest}` : null;
  }

  async function handleExport(format: ExportFormat) {
    const modelPath = latestModelPath();
    if (!modelPath) return;
    await window.api.exportModel({ modelPath, format });
  }

  async function handleRender() {
    const modelPath = latestModelPath();
    if (!project || !modelPath) return;
    setRendering(true);
    try {
      await window.api.renderModel({
        projectId: project.id,
        backendId: project.modelingBackend,
        modelPath,
        outDir: project.dir,
      });
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Camera tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
        {CAMERAS.map((cam) => (
          <button
            key={cam}
            onClick={() => setActiveCamera(cam)}
            className={`px-3 py-0.5 rounded text-xs font-medium transition-colors ${
              activeCamera === cam
                ? "bg-white/10 text-gray-100"
                : "text-gray-500 hover:text-gray-300"
            }`}
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

      {/* PNG viewer */}
      <div className="flex-1 flex items-center justify-center bg-[#0a0d12] overflow-hidden">
        {pngPath ? (
          <img
            src={`file://${encodeURI(pngPath)}`}
            alt={`${activeCamera} view`}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <p className="text-gray-600 text-sm">No preview yet</p>
        )}
      </div>
    </div>
  );
}
