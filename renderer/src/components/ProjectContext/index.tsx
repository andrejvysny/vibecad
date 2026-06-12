import { useEffect, useState } from "react";
import type { Project } from "../../stores/project.store";
import { WorkflowsManager } from "./WorkflowsManager";

type Tab = "instructions" | "skills" | "references" | "workflows";

/**
 * Per-project context surface. Everything here is backed by files under the
 * project's `.studio/` dir and injected into every agent turn by the main
 * process (buildAgentContext). Workflows get their own tab in a later phase.
 */
export function ProjectContext({ project }: { project: Project | null }) {
  const [tab, setTab] = useState<Tab>("instructions");

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-600">
        Open a project to edit its context.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Project Context
        </span>
        <span className="truncate text-xs text-gray-500">{project.name}</span>
        <div className="flex-1" />
        {(["instructions", "skills", "references", "workflows"] as Tab[]).map(
          (t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 text-xs capitalize ${
                tab === t
                  ? "bg-white/10 text-gray-100"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {t}
            </button>
          ),
        )}
      </div>
      {/* key remounts per project + tab so transient state can't leak. */}
      {tab === "instructions" ? (
        <InstructionsEditor key={project.id} projectId={project.id} />
      ) : tab === "skills" ? (
        <FileManager
          key={`${project.id}-skills`}
          projectId={project.id}
          kind="skills"
        />
      ) : tab === "references" ? (
        <FileManager
          key={`${project.id}-refs`}
          projectId={project.id}
          kind="references"
        />
      ) : (
        <WorkflowsManager key={`${project.id}-wf`} projectId={project.id} />
      )}
    </div>
  );
}

function InstructionsEditor({ projectId }: { projectId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .readInstructions({ projectId })
      .then((t) => {
        if (cancelled) return;
        setText(t);
        setSaved(t);
      })
      .catch((e) => !cancelled && setError(asMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const dirty = text !== null && text !== saved;

  const save = async () => {
    if (text === null || !dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.writeInstructions({ projectId, content: text });
      setSaved(text);
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 text-xs text-gray-500">
        Guidance injected into every agent turn (all agents). Markdown.
      </div>
      <textarea
        value={text ?? ""}
        disabled={text === null}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            void save();
          }
        }}
        placeholder={
          text === null ? "Loading…" : "e.g. Target Bambu A1, 0.4mm nozzle…"
        }
        className="m-3 min-h-0 flex-1 resize-none rounded border border-white/10 bg-[#0a0d12] p-3 font-mono text-xs leading-relaxed text-gray-200 outline-none focus:border-white/30"
      />
      <div className="flex items-center gap-3 border-t border-white/10 px-3 py-2">
        <button
          onClick={() => void save()}
          disabled={!dirty || busy}
          className="rounded border border-white/10 px-3 py-1 text-xs text-gray-300 enabled:hover:border-white/30 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <span className="text-xs text-gray-500">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : dirty ? (
            "Unsaved changes · ⌘S"
          ) : text !== null ? (
            "Saved"
          ) : (
            ""
          )}
        </span>
      </div>
    </div>
  );
}

const COPY = {
  skills: {
    blurb:
      "Custom skills (each a folder with SKILL.md) layered on the backend skill.",
    add: "Import skill…",
    empty: "No custom skills. The bundled backend skill always applies.",
  },
  references: {
    blurb: "Reference files the agent can read while working.",
    add: "Add file…",
    empty: "No reference files.",
  },
} as const;

function FileManager({
  projectId,
  kind,
}: {
  projectId: string;
  kind: "skills" | "references";
}) {
  const [items, setItems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[kind];

  const list = () =>
    kind === "skills"
      ? window.api.listSkills({ projectId })
      : window.api.listReferences({ projectId });

  useEffect(() => {
    let cancelled = false;
    list()
      .then((r) => !cancelled && setItems(r))
      .catch((e) => !cancelled && setError(asMessage(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind]);

  const run = async (op: Promise<string[]>) => {
    setBusy(true);
    setError(null);
    try {
      setItems(await op);
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(
      kind === "skills"
        ? window.api.importSkill({ projectId })
        : window.api.addReference({ projectId }),
    );

  const remove = (name: string) =>
    run(
      kind === "skills"
        ? window.api.removeSkill({ projectId, name })
        : window.api.removeReference({ projectId, name }),
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3 pt-3">
        <span className="flex-1 text-xs text-gray-500">{copy.blurb}</span>
        <button
          onClick={() => void add()}
          disabled={busy}
          className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 enabled:hover:border-white/30 disabled:opacity-40"
        >
          ＋ {copy.add}
        </button>
      </div>
      {error && <p className="px-3 pt-2 text-xs text-red-400">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {items === null ? (
          <p className="text-xs text-gray-600">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-gray-600">{copy.empty}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded border border-white/10 px-2 py-1.5"
              >
                <span className="flex-1 truncate font-mono text-xs text-gray-200">
                  {name}
                </span>
                <button
                  onClick={() => void remove(name)}
                  disabled={busy}
                  title="Remove"
                  className="rounded px-1.5 text-xs text-gray-500 hover:text-red-400 disabled:opacity-40"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
