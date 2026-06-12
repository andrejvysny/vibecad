import { useState } from "react";
import { useProjectStore } from "../../stores/project.store";
import { useViewStore } from "../../stores/view.store";
import { cn } from "../../lib/cn";
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
// Group key: every artifact of one model shares its `model_NNN` prefix.
function groupKey(f: string): string {
  return /^(model_\d+)/.exec(f)?.[1] ?? basename(f);
}
function modelNum(key: string): number {
  return Number(/^model_(\d+)/.exec(key)?.[1] ?? -1);
}

interface Group {
  key: string;
  source?: string;
  exports: string[];
  previews: string[];
}

function buildGroups(files: string[]): Group[] {
  const map = new Map<string, Group>();
  const get = (k: string): Group => {
    let g = map.get(k);
    if (!g) {
      g = { key: k, exports: [], previews: [] };
      map.set(k, g);
    }
    return g;
  };
  for (const f of files) {
    const e = ext(f);
    const g = get(groupKey(f));
    if (SOURCE_EXTS.has(e)) g.source = f;
    else if (EXPORT_EXTS.has(e)) g.exports.push(f);
    else if (PREVIEW_EXTS.has(e)) g.previews.push(f);
  }
  return [...map.values()].sort((a, b) => modelNum(b.key) - modelNum(a.key));
}

interface Props {
  project: Project | null;
}

export function WorkspaceTree({ project }: Props) {
  if (!project) {
    return (
      <div className="flex flex-col h-full">
        <Header>Workspace</Header>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-600">No project open</p>
        </div>
      </div>
    );
  }

  const groups = buildGroups(project.files);

  return (
    <div className="flex flex-col h-full">
      <Header>{project.name}</Header>
      <div className="flex-1 overflow-y-auto py-1">
        {groups.length === 0 && (
          <p className="px-3 py-1 text-xs text-gray-600">No models yet</p>
        )}
        {groups.map((g) => (
          <GroupRow
            key={g.key}
            project={project}
            group={g}
            active={project.activeModel === g.key}
          />
        ))}
      </div>
    </div>
  );
}

function GroupRow({
  project,
  group,
  active,
}: {
  project: Project;
  group: Group;
  active: boolean;
}) {
  const [open, setOpen] = useState(active);
  const hasStl = group.exports.some((f) => ext(f) === ".stl");

  // Selecting the group: focus this model (3D if an STL exists, else its source).
  function select() {
    useProjectStore.getState().setActiveModel(project.id, group.key);
    if (hasStl) useViewStore.getState().show3d();
    else if (group.source) useViewStore.getState().showSource(group.source);
  }

  function openExport(f: string) {
    if (ext(f) === ".stl") {
      useProjectStore.getState().setActiveModel(project.id, basename(f));
      useViewStore.getState().show3d();
    } else {
      void window.api.revealItem({ path: `${project.dir}/${f}` });
    }
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-0.5 text-xs",
          active ? "bg-white/10" : "hover:bg-white/5",
        )}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className="grid place-items-center w-4 h-4 text-gray-500 hover:text-gray-300 shrink-0"
        >
          <Chevron open={open} />
        </button>
        <button
          onClick={select}
          className="flex-1 text-left truncate text-gray-200"
        >
          {group.key}
        </button>
        {active && (
          <span className="text-[9px] uppercase tracking-wide text-blue-400/80 shrink-0">
            current
          </span>
        )}
      </div>
      {open && (
        <div className="pl-6 pr-2 pb-0.5">
          {group.source && (
            <Leaf
              label={ext(group.source)}
              color="text-blue-300"
              onClick={() => {
                useProjectStore
                  .getState()
                  .setActiveModel(project.id, group.key);
                useViewStore.getState().showSource(group.source!);
              }}
            />
          )}
          {group.exports.map((f) => (
            <Leaf
              key={f}
              label={ext(f).slice(1)}
              color="text-green-300"
              onClick={() => openExport(f)}
            />
          ))}
          {group.previews.map((f) => (
            <Leaf
              key={f}
              label={previewLabel(f, group.key)}
              color="text-gray-400"
              onClick={() => useViewStore.getState().showImage(f)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// `model_002_iso.png` → `iso` (the render angle), else the bare filename.
function previewLabel(file: string, key: string): string {
  const m = new RegExp(`^${key}_(\\w+)\\.png$`).exec(file);
  return m ? m[1]! : file;
}

function Leaf({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full text-left py-0.5 text-xs truncate hover:text-white",
        color,
      )}
    >
      {label}
    </button>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wide truncate">
      {children}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className={cn("transition-transform", open && "rotate-90")}
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
