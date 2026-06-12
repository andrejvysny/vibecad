import type { Project } from "../../stores/project.store";

const SOURCE_EXTS = new Set([".scad", ".py"]);
const PREVIEW_EXTS = new Set([".png"]);
const EXPORT_EXTS = new Set([".stl", ".3mf", ".step", ".dxf"]);

function ext(filename: string): string {
  return filename.slice(filename.lastIndexOf("."));
}

interface Props {
  project: Project | null;
}

export function WorkspaceTree({ project }: Props) {
  if (!project) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wide">
          Workspace
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-600">No project open</p>
        </div>
      </div>
    );
  }

  const sources = project.files.filter((f) => SOURCE_EXTS.has(ext(f)));
  const previews = project.files.filter((f) => PREVIEW_EXTS.has(ext(f)));
  const exports = project.files.filter((f) => EXPORT_EXTS.has(ext(f)));

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wide">
        {project.name}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {sources.map((f) => (
          <FileRow
            key={f}
            name={f}
            color="text-blue-300"
            onClick={() =>
              void window.api.openModel({ modelPath: `${project.dir}/${f}` })
            }
          />
        ))}
        {exports.map((f) => (
          <FileRow
            key={f}
            name={f}
            color="text-green-300"
            onClick={() =>
              void window.api.openModel({ modelPath: `${project.dir}/${f}` })
            }
          />
        ))}
        {previews.map((f) => (
          <FileRow key={f} name={f} color="text-gray-500" />
        ))}
      </div>
    </div>
  );
}

function FileRow({
  name,
  color,
  onClick,
}: {
  name: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-0.5 text-xs truncate hover:bg-white/5 ${color}`}
    >
      {name}
    </button>
  );
}
