import { useBackendStore } from "../../stores/backend.store";
import type { Project } from "../../stores/project.store";
import type { ExportFormat } from "@shared/types";

interface Props {
  project: Project | null;
}

export function ExportBar({ project }: Props) {
  const backends = useBackendStore((s) => s.detected);
  const backend = backends.find((b) => b.id === project?.modelingBackend);

  async function handleExport(format: ExportFormat) {
    const srcExt = project?.modelingBackend === "openscad" ? ".scad" : ".py";
    const latestSrc = project?.files.filter((f) => f.endsWith(srcExt)).at(-1);
    if (!project || !latestSrc) return;
    await window.api.exportModel({
      modelPath: `${project.dir}/${latestSrc}`,
      format,
    });
  }

  if (!backend?.exports.length) return null;

  return (
    <div className="flex gap-2 p-2">
      {backend.exports.map((fmt) => (
        <button
          key={fmt}
          onClick={() => void handleExport(fmt)}
          className="px-3 py-1 text-xs border border-white/10 rounded text-gray-300 hover:border-white/30 hover:text-white"
        >
          Export {fmt.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
