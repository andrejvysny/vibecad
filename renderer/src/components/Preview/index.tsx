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
  const backends = useBackendStore((s) => s.detected);

  const backend = backends.find((b) => b.id === project?.modelingBackend);
  const pngPath = project?.previews[activeCamera];

  async function handleExport(format: ExportFormat) {
    const latestModel = project?.files
      .filter((f) =>
        f.endsWith(project.modelingBackend === "openscad" ? ".scad" : ".py"),
      )
      .at(-1);
    if (!project || !latestModel) return;
    await window.api.exportModel({
      modelPath: `${project.dir}/${latestModel}`,
      format,
    });
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
            src={`file://${pngPath}`}
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
