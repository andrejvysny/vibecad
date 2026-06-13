import { useState } from "react";
import { useProjectStore } from "../../stores/project.store";
import { useAgentStore } from "../../stores/agent.store";
import { useViewStore } from "../../stores/view.store";
import { cn } from "../../lib/cn";
import {
  buildGroups,
  basename,
  DISPLAYABLE,
  ext,
  modelNum,
  previewLabel,
  type Group,
} from "./groups";
import type { Project } from "../../stores/project.store";

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
  const assembly = groups.find((g) => g.kind === "assembly");
  const parts = groups
    .filter((g) => g.kind === "part")
    .sort((a, b) => a.key.localeCompare(b.key));
  const legacy = groups
    .filter((g) => g.kind === "legacy")
    .sort((a, b) => modelNum(b.key) - modelNum(a.key));

  const projectId = project.id;
  async function importStep() {
    const name = await window.api.importStep({ projectId });
    if (!name) return;
    // Focus the freshly imported model and show it in 3D.
    useProjectStore.getState().setActiveModel(projectId, basename(name));
    useViewStore.getState().show3d();
  }

  const empty = !assembly && parts.length === 0 && legacy.length === 0;

  return (
    <div className="flex flex-col h-full">
      <Header
        action={{ label: "Import STEP", onClick: () => void importStep() }}
      >
        {project.name}
      </Header>
      <div className="flex-1 overflow-y-auto py-1">
        {empty && (
          <p className="px-3 py-1 text-xs text-gray-600">No models yet</p>
        )}
        {assembly && (
          <GroupRow
            key={assembly.key}
            project={project}
            group={assembly}
            label="assembly"
            active={project.activeModel === assembly.key}
          />
        )}
        {parts.length > 0 && (
          <>
            <SectionLabel>Parts</SectionLabel>
            {parts.map((g) => (
              <PartRow
                key={g.key}
                project={project}
                group={g}
                active={project.activeModel === g.key}
              />
            ))}
          </>
        )}
        {legacy.length > 0 && (
          <>
            {(assembly || parts.length > 0) && (
              <SectionLabel>Models</SectionLabel>
            )}
            {legacy.map((g) => (
              <GroupRow
                key={g.key}
                project={project}
                group={g}
                label={g.key}
                active={project.activeModel === g.key}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// A part: checkbox toggles it into the next turn's edit scope; the name inspects
// it (each part is a standalone model with its own preview + params); × removes
// the file and asks the agent to drop it from the assembly.
function PartRow({
  project,
  group,
  active,
}: {
  project: Project;
  group: Group;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const editScope = useProjectStore((s) => s.editScope);
  const toggleScope = useProjectStore((s) => s.toggleEditScope);
  const scoped = !!group.source && editScope.includes(group.source);
  const name = group.key.replace(/^parts\//, "");

  // Always open the part in 3D — the viewport lazily exports its mesh if none
  // exists yet. The source stays reachable via the expanded row's source leaf.
  function inspect() {
    useProjectStore.getState().setActiveModel(project.id, group.key);
    useViewStore.getState().show3d();
  }

  async function remove() {
    if (!group.source) return;
    await window.api.deletePart({ projectId: project.id, part: group.source });
    if (scoped) toggleScope(group.source);
    void useAgentStore.getState().run({
      prompt: `I removed the "${name}" part (${group.source}). Update the assembly to drop its reference and recompose so the model still builds.`,
      projectId: project.id,
    });
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-0.5 text-xs",
          active ? "bg-white/10" : "hover:bg-white/5",
        )}
      >
        <input
          type="checkbox"
          checked={scoped}
          disabled={!group.source}
          onChange={() => group.source && toggleScope(group.source)}
          title="Restrict the next edit to this part"
          className="shrink-0 accent-blue-500"
        />
        <button
          onClick={() => setOpen((v) => !v)}
          className="grid place-items-center w-4 h-4 text-gray-500 hover:text-gray-300 shrink-0"
        >
          <Chevron open={open} />
        </button>
        <button
          onClick={inspect}
          className="flex-1 text-left truncate text-gray-200"
        >
          {name}
        </button>
        <button
          onClick={() => void remove()}
          title="Remove this part"
          className="shrink-0 px-1 text-gray-600 hover:text-red-400"
        >
          ×
        </button>
      </div>
      {open && (
        <div className="pl-10 pr-2 pb-0.5">
          {group.source && (
            <Leaf
              label={ext(group.source).slice(1)}
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
              onClick={() => openExport(project, group, f)}
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

function GroupRow({
  project,
  group,
  label,
  active,
}: {
  project: Project;
  group: Group;
  label: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(active);
  const hasMesh = group.exports.some((f) => DISPLAYABLE.has(ext(f)));

  // Selecting the group: focus this model (3D if a mesh exists, else its source).
  function select() {
    useProjectStore.getState().setActiveModel(project.id, group.key);
    if (hasMesh) useViewStore.getState().show3d();
    else if (group.source) useViewStore.getState().showSource(group.source);
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
          {label}
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
              label={ext(group.source).slice(1)}
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
              onClick={() => openExport(project, group, f)}
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

function openExport(project: Project, group: Group, f: string) {
  if (DISPLAYABLE.has(ext(f))) {
    useProjectStore.getState().setActiveModel(project.id, group.key);
    useViewStore.getState().show3d();
  } else {
    void window.api.revealItem({ path: `${project.dir}/${f}` });
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
      {children}
    </div>
  );
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

function Header({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wide">
      <span className="flex-1 truncate">{children}</span>
      {action && (
        <button
          onClick={action.onClick}
          className="shrink-0 normal-case px-1.5 py-0.5 rounded border border-white/10 text-[10px] text-gray-300 hover:border-white/30 hover:text-white"
        >
          {action.label}
        </button>
      )}
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
