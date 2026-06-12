import { useProjectStore } from "../../stores/project.store";
import { useViewStore } from "../../stores/view.store";
import type { Project } from "../../stores/project.store";

const SOURCE_EXTS = new Set([".scad", ".py"]);
const PREVIEW_EXTS = new Set([".png"]);
const EXPORT_EXTS = new Set([".stl", ".3mf", ".step", ".dxf"]);

function ext(filename: string): string {
  return filename.slice(filename.lastIndexOf("."));
}

function basename(filename: string): string {
  return filename.slice(0, filename.lastIndexOf("."));
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

  const proj = project;
  const sources = proj.files.filter((f) => SOURCE_EXTS.has(ext(f)));
  const previews = proj.files.filter((f) => PREVIEW_EXTS.has(ext(f)));
  const exports = proj.files.filter((f) => EXPORT_EXTS.has(ext(f)));

  // Clicking a source: make it the active model AND show its source in-app.
  function openSource(f: string): void {
    useProjectStore.getState().setActiveModel(proj.id, basename(f));
    useViewStore.getState().showSource(f);
  }

  // Clicking an export: if it's an STL, view it in 3D; else reveal in Finder.
  function openExport(f: string): void {
    if (ext(f) === ".stl") {
      useProjectStore.getState().setActiveModel(proj.id, basename(f));
      useViewStore.getState().show3d();
    } else {
      void window.api.revealItem({ path: `${proj.dir}/${f}` });
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wide">
        {proj.name}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {sources.map((f) => (
          <FileRow
            key={f}
            name={f}
            color="text-blue-300"
            active={proj.activeModel === basename(f)}
            onClick={() => openSource(f)}
          />
        ))}
        {exports.map((f) => (
          <FileRow
            key={f}
            name={f}
            color="text-green-300"
            onClick={() => openExport(f)}
          />
        ))}
        {previews.map((f) => (
          <FileRow
            key={f}
            name={f}
            color="text-gray-500"
            onClick={() => useViewStore.getState().showImage(f)}
          />
        ))}
      </div>
    </div>
  );
}

function FileRow({
  name,
  color,
  active,
  onClick,
}: {
  name: string;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-0.5 text-xs truncate hover:bg-white/5 ${color} ${
        active ? "bg-white/10" : ""
      }`}
    >
      {name}
    </button>
  );
}
