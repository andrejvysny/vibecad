import { useEffect, useState } from "react";
import type { Workflow, WorkflowStep } from "@shared/types";
import { useWorkflowStore } from "../../stores/workflow.store";

/** Build, run, and manage saved recipes for a project (.studio/workflows). */
export function WorkflowsManager({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Workflow[] | null>(null);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useWorkflowStore((s) => s.run);

  useEffect(() => {
    let cancelled = false;
    window.api
      .listWorkflows({ projectId })
      .then((r) => !cancelled && setItems(r))
      .catch((e) => !cancelled && setError(asMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = async (wf: Workflow) => {
    setError(null);
    try {
      setItems(await window.api.saveWorkflow({ projectId, workflow: wf }));
      setEditing(null);
    } catch (e) {
      setError(asMessage(e));
    }
  };

  const remove = async (slug: string) => {
    setError(null);
    try {
      setItems(await window.api.deleteWorkflow({ projectId, slug }));
    } catch (e) {
      setError(asMessage(e));
    }
  };

  const start = (slug: string, fromStep = 0) => {
    useWorkflowStore.getState().begin(projectId, slug, fromStep);
    void window.api.runWorkflow({ projectId, slug, fromStep });
  };

  if (editing) {
    return (
      <WorkflowEditor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSave={save}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3 pt-3">
        <span className="flex-1 text-xs text-gray-500">
          Recipes run as sequential agent turns. Steps with “pause after” wait
          for you before continuing.
        </span>
        <button
          onClick={() => setEditing(blankWorkflow())}
          className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:border-white/30"
        >
          ＋ New workflow
        </button>
      </div>
      {error && <p className="px-3 pt-2 text-xs text-red-400">{error}</p>}
      {run && <RunBanner onContinue={start} />}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {items === null ? (
          <p className="text-xs text-gray-600">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-gray-600">No workflows yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((wf) => (
              <li
                key={wf.slug}
                className="rounded border border-white/10 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm text-gray-200">
                    {wf.name}
                  </span>
                  <button
                    onClick={() => start(wf.slug)}
                    disabled={run?.status === "running"}
                    className="rounded border border-white/10 px-2 py-0.5 text-xs text-green-300 enabled:hover:border-white/30 disabled:opacity-40"
                  >
                    ▶ Run
                  </button>
                  <button
                    onClick={() => setEditing(wf)}
                    className="rounded border border-white/10 px-2 py-0.5 text-xs text-gray-400 hover:border-white/30"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void remove(wf.slug)}
                    title="Delete"
                    className="rounded px-1.5 text-xs text-gray-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
                {wf.description && (
                  <p className="mt-1 text-xs text-gray-500">{wf.description}</p>
                )}
                <p className="mt-1 text-[11px] text-gray-600">
                  {wf.steps.length} step{wf.steps.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunBanner({
  onContinue,
}: {
  onContinue: (slug: string, fromStep: number) => void;
}) {
  const run = useWorkflowStore((s) => s.run);
  const clear = useWorkflowStore((s) => s.clear);
  if (!run) return null;

  const label =
    run.status === "running"
      ? `Running step ${run.index + 1}/${run.total || "?"}: ${run.title}`
      : run.status === "paused"
        ? `Paused after step ${run.index + 1}/${run.total}`
        : run.status === "finished"
          ? "Workflow finished"
          : run.status === "error"
            ? `Error on step ${run.index + 1}`
            : `Step ${run.index + 1} done`;

  return (
    <div className="mx-3 mt-2 flex items-center gap-3 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs">
      <span className="flex-1 text-gray-200">{label}</span>
      {run.status === "paused" && run.nextStep !== undefined && (
        <button
          onClick={() => onContinue(run.slug, run.nextStep ?? 0)}
          className="rounded border border-white/10 px-2 py-0.5 text-green-300 hover:border-white/30"
        >
          Continue
        </button>
      )}
      {(run.status === "finished" || run.status === "error") && (
        <button
          onClick={clear}
          className="rounded border border-white/10 px-2 py-0.5 text-gray-300 hover:border-white/30"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

function WorkflowEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: Workflow;
  onCancel: () => void;
  onSave: (wf: Workflow) => void;
}) {
  const [wf, setWf] = useState<Workflow>(initial);

  const patchStep = (i: number, patch: Partial<WorkflowStep>) =>
    setWf((w) => ({
      ...w,
      steps: w.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));

  const addStep = () =>
    setWf((w) => ({ ...w, steps: [...w.steps, { title: "", prompt: "" }] }));

  const removeStep = (i: number) =>
    setWf((w) => ({ ...w, steps: w.steps.filter((_, j) => j !== i) }));

  const canSave =
    wf.name.trim() !== "" && wf.steps.some((s) => s.prompt.trim());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <input
          value={wf.name}
          onChange={(e) => setWf({ ...wf, name: e.target.value })}
          placeholder="Workflow name"
          className="w-full rounded border border-white/10 bg-[#0a0d12] px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-white/30"
        />
        <input
          value={wf.description ?? ""}
          onChange={(e) => setWf({ ...wf, description: e.target.value })}
          placeholder="Description (optional)"
          className="w-full rounded border border-white/10 bg-[#0a0d12] px-2 py-1.5 text-xs text-gray-300 outline-none focus:border-white/30"
        />
        {wf.steps.map((s, i) => (
          <div key={i} className="rounded border border-white/10 p-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-600">Step {i + 1}</span>
              <input
                value={s.title}
                onChange={(e) => patchStep(i, { title: e.target.value })}
                placeholder="Title"
                className="flex-1 rounded border border-white/10 bg-[#0a0d12] px-2 py-1 text-xs text-gray-200 outline-none focus:border-white/30"
              />
              <button
                onClick={() => removeStep(i)}
                className="px-1.5 text-xs text-gray-500 hover:text-red-400"
              >
                ✕
              </button>
            </div>
            <textarea
              value={s.prompt}
              onChange={(e) => patchStep(i, { prompt: e.target.value })}
              placeholder="Prompt sent to the agent for this step"
              rows={2}
              className="mt-2 w-full resize-y rounded border border-white/10 bg-[#0a0d12] px-2 py-1 font-mono text-xs text-gray-200 outline-none focus:border-white/30"
            />
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
              <input
                type="checkbox"
                checked={s.autoAdvance === false}
                onChange={(e) =>
                  patchStep(i, {
                    autoAdvance: e.target.checked ? false : undefined,
                  })
                }
              />
              Pause after this step
            </label>
          </div>
        ))}
        <button
          onClick={addStep}
          className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:border-white/30"
        >
          ＋ Add step
        </button>
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <button
          onClick={() => onSave(wf)}
          disabled={!canSave}
          className="rounded border border-white/10 px-3 py-1 text-xs text-gray-200 enabled:hover:border-white/30 disabled:opacity-40"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function blankWorkflow(): Workflow {
  return {
    slug: "",
    name: "",
    kind: "recipe",
    steps: [{ title: "", prompt: "" }],
  };
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
