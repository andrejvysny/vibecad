import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../../stores/project.store";
import { cn } from "../../lib/cn";
import type { Project } from "../../stores/project.store";

/**
 * Title-bar project picker: switch the active project and manage the list
 * (rename inline, delete with confirm, reveal folder in Finder).
 */
export function ProjectSwitcher() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) => s.activeProject);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click (ignored while a confirm modal is up).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const confirmTarget = projects.find((p) => p.id === confirmId) ?? null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-sm font-medium text-gray-200 hover:bg-white/5"
      >
        <span className="truncate max-w-50">
          {activeProject?.name ?? "No project"}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 max-h-96 overflow-y-auto bg-[#1a1d27] border border-white/10 rounded-lg shadow-xl py-1 z-50">
          {projects.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-500">No projects yet</p>
          )}
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              active={p.id === activeProjectId}
              editing={editingId === p.id}
              onSelect={() => {
                useProjectStore.getState().setActive(p.id);
                setOpen(false);
              }}
              onStartRename={() => setEditingId(p.id)}
              onCommitRename={(name) => {
                setEditingId(null);
                const trimmed = name.trim();
                if (trimmed && trimmed !== p.name) {
                  void useProjectStore.getState().renameProject(p.id, trimmed);
                }
              }}
              onReveal={() => void window.api.revealItem({ path: p.dir })}
              onDelete={() => setConfirmId(p.id)}
            />
          ))}
        </div>
      )}

      {confirmTarget && (
        <DeleteConfirm
          project={confirmTarget}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => {
            const id = confirmTarget.id;
            setConfirmId(null);
            setOpen(false);
            void useProjectStore.getState().deleteProject(id);
          }}
        />
      )}
    </div>
  );
}

function ProjectRow({
  project,
  active,
  editing,
  onSelect,
  onStartRename,
  onCommitRename,
  onReveal,
  onDelete,
}: {
  project: Project;
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          defaultValue={project.name}
          onBlur={(e) => onCommitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") onCommitRename(project.name);
          }}
          className="w-full bg-white/5 border border-white/20 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-400"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 px-2 py-1 text-sm cursor-pointer",
        active ? "bg-white/10" : "hover:bg-white/5",
      )}
    >
      <button
        onClick={onSelect}
        className="flex-1 flex items-center gap-2 min-w-0 text-left"
      >
        <span className="w-3 shrink-0 text-blue-400">{active ? "✓" : ""}</span>
        <span className="truncate text-gray-200">{project.name}</span>
        <span className="text-[9px] uppercase tracking-wide text-gray-600 shrink-0">
          {project.modelingBackend === "openscad" ? "scad" : "b123d"}
        </span>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
        <RowAction title="Rename" onClick={onStartRename}>
          ✎
        </RowAction>
        <RowAction title="Reveal in Finder" onClick={onReveal}>
          ⤢
        </RowAction>
        <RowAction title="Delete" onClick={onDelete} danger>
          ✕
        </RowAction>
      </div>
    </div>
  );
}

function RowAction({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid place-items-center w-5 h-5 rounded text-xs text-gray-400 hover:bg-white/10",
        danger ? "hover:text-red-400" : "hover:text-gray-100",
      )}
    >
      {children}
    </button>
  );
}

function DeleteConfirm({
  project,
  onCancel,
  onConfirm,
}: {
  project: Project;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-white/10 rounded-lg p-6 w-96 space-y-4">
        <h2 className="text-base font-semibold text-gray-100">
          Delete project?
        </h2>
        <p className="text-sm text-gray-400">
          “{project.name}” will be permanently removed, including its files on
          disk and chat history. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={cn("transition-transform text-gray-500", open && "rotate-180")}
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
