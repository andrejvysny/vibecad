import { stat } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import log from "electron-log/main";
import { getAdapter, registerActive } from "./agents/index.js";
import { getBackend } from "./modeling/index.js";
import { resolveOpenscad } from "./modeling/resolve-openscad.js";
import { initDb } from "./db/index.js";
import { projects } from "./db/schema.js";
import {
  getOrCreateSession,
  insertMessage,
  setAgentSessionId,
} from "./chat.js";
import { getSkillsDir } from "./paths.js";
import { buildAgentContext } from "./agent-context.js";
import { getWorkflow } from "./workflows.js";
import { latestModel, listPartSources, renderSnapshots } from "./preview.js";
import { runGateChain } from "./repair/gates.js";
import { decideNextAction } from "./repair/policy.js";
import {
  buildEditScopePrompt,
  buildRepairPrompt,
  buildVisionPrompt,
} from "./repair/prompts.js";
import { sendToRenderer } from "./window.js";
import type { ProjectRow } from "./projects.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentId,
  CameraPreset,
  GateId,
  TurnVerdict,
} from "../../../shared/types.js";
import {
  AGENT_SUPPORTS_VISION,
  ESCALATION_MODELS,
} from "../../../shared/types.js";
import type {
  SelectionFeedback,
  TurnStatusPayload,
  WorkflowStepPayload,
} from "../../../shared/ipc.js";

const MAX_REPAIRS = 2;
// Total user-facing fix budget = same-model repairs + one escalation. Used only
// for the "pass N/M" label so escalation reads as "3/3", not a confusing "3/2".
const MAX_FIX_ATTEMPTS = MAX_REPAIRS + 1;
const STALL_GRACE_MS = 5_000;
const STALL_MSG = "Agent run stalled and was stopped.";

// Per-project loop aborter. `agent:stop` aborts so the self-repair loop halts
// before its next turn (the child is killed separately via killActive).
const turnAborts = new Map<string, AbortController>();

export function abortTurn(projectId: string): void {
  turnAborts.get(projectId)?.abort();
}

// Built once per user turn, reused by repair/vision turns.
interface TurnCtx {
  project: ProjectRow;
  adapter: AgentAdapter;
  projectId: string;
  env: Record<string, string>;
  preamble: string;
  contextDirs: string[];
  abort: AbortSignal;
}

interface ExecOpts {
  kind: "chat" | "repair" | "vision";
  includePreamble?: boolean; // false on resumed repair turns (token save)
  modelOverride?: string; // L6 escalation
}

/**
 * Run a user turn end-to-end: the chat turn, then the deterministic gate chain,
 * then up to `MAX_REPAIRS` same-model repairs + one model escalation, all as
 * resumed agent turns. Returns whether any turn stalled (for the workflow runner).
 */
export async function runAgentTurn(
  projectId: string,
  prompt: string,
  attachments?: string[],
  verify = false,
  selection?: SelectionFeedback,
  editScope?: string[],
): Promise<{ stalled: boolean }> {
  const db = initDb();
  const [project] = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .all();
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const adapter = getAdapter(
    project.agentId as Parameters<typeof getAdapter>[0],
  );
  if (!adapter) throw new Error(`Agent not found: ${project.agentId}`);

  // Expose the resolved OpenSCAD binary so the agent's headless validation works
  // even when OpenSCAD isn't on PATH (the skill reads $OPENSCAD_BIN).
  const env: Record<string, string> = {};
  if (project.modelingBackend === "openscad") {
    const osc = await resolveOpenscad();
    if (osc) env["OPENSCAD_BIN"] = osc;
  }

  const { preamble, contextDirs } = await buildAgentContext(project, {
    bundledSkillDir: getSkillsDir(project.modelingBackend),
    attachments,
    selection,
  });

  const session = getOrCreateSession(projectId, project.agentId);
  // Persist the user's own text; the agent receives a scope-prefixed copy so the
  // chat history stays clean (multi-part edit scope, prompt-guidance only).
  insertMessage(session.id, "user", prompt, undefined, "chat");
  const scopedPrompt = editScope?.length
    ? `${buildEditScopePrompt(editScope)}\n\n${prompt}`
    : prompt;

  const abort = new AbortController();
  turnAborts.set(projectId, abort);
  const ctx: TurnCtx = {
    project,
    adapter,
    projectId,
    env,
    preamble,
    contextDirs,
    abort: abort.signal,
  };
  try {
    return await runTurnPipeline(
      ctx,
      scopedPrompt,
      session.id,
      verify,
      editScope,
    );
  } finally {
    turnAborts.delete(projectId);
  }
}

/** Chat turn + self-repair loop + optional vision pass. Skips all for Q&A turns. */
async function runTurnPipeline(
  ctx: TurnCtx,
  prompt: string,
  sessionId: string,
  verify: boolean,
  editScope?: string[],
): Promise<{ stalled: boolean }> {
  const { project, projectId } = ctx;
  const backend = getBackend(project.modelingBackend);
  const escalationModel = ESCALATION_MODELS[project.agentId as AgentId];
  let currentModel = project.agentModel ?? undefined;
  let attempt = 0;
  let visionUsed = false;

  const before = await modelStat(project);
  let turn = await executeTurn(ctx, prompt, { kind: "chat" });
  if (turn.stalled) return failStall(projectId);

  // No new or changed model ⇒ a Q&A turn: zero pipeline cost.
  const after = await modelStat(project);
  if (!backend || !after || unchanged(before, after)) return { stalled: false };

  for (;;) {
    if (ctx.abort.aborted) return { stalled: false };
    const modelPath = (await latestModel(project)) ?? after.path;
    sendStatus({ projectId, phase: "validating" });
    const verdict = await runGateChain(backend, modelPath, project.outputNeed);
    const action = decideNextAction(verdict, attempt, {
      maxRepairs: MAX_REPAIRS,
      escalationModel,
      currentModel,
    });

    if (action.kind === "accept") {
      if (verdict.meshPath) {
        sendToRenderer("preview:mesh-ready", {
          projectId,
          meshPath: verdict.meshPath,
        });
      }
      // L5 — a vision turn is warranted after a repair, on the Verify toggle, or
      // a final workflow step; otherwise just render the iso thumbnail (free).
      const supportsVision = AGENT_SUPPORTS_VISION[project.agentId as AgentId];
      const warranted =
        !visionUsed && supportsVision && (verify || attempt > 0);
      const vision = await runVision(ctx, modelPath, sessionId, warranted);
      if (vision.stalled) return failStall(projectId);
      if (vision.ranTurn) visionUsed = true;
      if (vision.changed) continue; // the vision edit re-enters the gate chain
      // Per-part visual check for the parts the user scoped this turn — each part
      // is a standalone model, so renderSnapshots/runVision work on it directly.
      if (warranted && editScope?.length) {
        let partChanged = false;
        for (const part of editScope) {
          const pv = await runVision(
            ctx,
            join(project.dir, part),
            sessionId,
            true,
          );
          if (pv.stalled) return failStall(projectId);
          if (pv.changed) {
            partChanged = true;
            break;
          }
        }
        if (partChanged) continue; // a part edit re-enters the gate chain
      }
      sendStatus({ projectId, phase: "ok" });
      return { stalled: false };
    }
    if (action.kind === "give-up") {
      sendFailed(projectId, failMessage(verdict));
      return { stalled: false };
    }

    const fail = firstFailure(verdict);
    const escalate = action.kind === "escalate";
    attempt = escalate ? attempt + 1 : action.attempt;
    if (escalate) currentModel = action.model;
    const repairPrompt = buildRepairPrompt({
      modelPath,
      gate: fail.gate,
      attempt,
      maxAttempts: MAX_FIX_ATTEMPTS,
      errors: fail.errors,
      warnings: fail.warnings,
    });
    insertMessage(sessionId, "user", repairPrompt, undefined, "repair");
    sendStatus({
      projectId,
      phase: escalate ? "escalating" : "repairing",
      attempt,
      maxAttempts: MAX_FIX_ATTEMPTS,
      gate: fail.gate,
      ...(escalate ? { message: `Escalating to ${action.model}…` } : {}),
    });
    turn = await executeTurn(ctx, repairPrompt, {
      kind: "repair",
      includePreamble: false,
      ...(escalate ? { modelOverride: action.model } : {}),
    });
    if (turn.stalled) return failStall(projectId);
  }
}

/**
 * Spawn the adapter for one turn, stream events, persist the assistant message,
 * and resolve when the child closes. Resume id + preamble are resolved fresh per
 * call. A stalled run (idle past the watchdog) is SIGTERM'd, then SIGKILL'd after
 * a grace period so a wedged CLI can't keep `close` from ever firing.
 */
function executeTurn(
  ctx: TurnCtx,
  prompt: string,
  opts: ExecOpts,
): Promise<{ stalled: boolean }> {
  const { adapter, project, projectId } = ctx;
  // Re-read the session so an updated resume id is picked up before each spawn.
  const session = getOrCreateSession(projectId, project.agentId);
  const resumeId =
    session.agentId === project.agentId
      ? (session.agentSessionId ?? undefined)
      : undefined;
  // Skip the preamble only on a resumed turn; a fresh session still needs it.
  const includePreamble = opts.includePreamble ?? true;
  const systemPreamble = includePreamble || !resumeId ? ctx.preamble : "";
  // (precedence: `(includePreamble || !resumeId)` then the ternary.)

  const child = adapter.spawn({
    prompt,
    workingDir: project.dir,
    contextDirs: ctx.contextDirs,
    systemPreamble,
    sessionId: resumeId,
    env: ctx.env,
    model: opts.modelOverride ?? project.agentModel ?? undefined,
  });
  registerActive(projectId, adapter.id, child);
  const onAbort = (): void => adapter.kill(child);
  ctx.abort.addEventListener("abort", onAbort, { once: true });

  let assistantText = "";
  const toolEvents: AgentEvent[] = [];
  let stalled = false;
  let settled = false;
  let watchdog: NodeJS.Timeout | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let forceTimer: NodeJS.Timeout | undefined;
  let resolveTurn!: (r: { stalled: boolean }) => void;
  let rejectTurn!: (e: Error) => void;
  const turn = new Promise<{ stalled: boolean }>((res, rej) => {
    resolveTurn = res;
    rejectTurn = rej;
  });
  const idleMs =
    Number(process.env["VIBECAD_AGENT_IDLE_TIMEOUT_MS"]) || 120_000;

  const cleanup = (): void => {
    if (watchdog) clearTimeout(watchdog);
    if (killTimer) clearTimeout(killTimer);
    if (forceTimer) clearTimeout(forceTimer);
    ctx.abort.removeEventListener("abort", onAbort);
  };
  // Settle exactly once — on `close`, or forced after SIGKILL if a zombie child
  // never closes (else the whole turn would hang).
  const settle = (): void => {
    if (settled) return;
    settled = true;
    cleanup();
    insertMessage(
      session.id,
      "assistant",
      assistantText,
      toolEvents.length ? JSON.stringify(toolEvents) : undefined,
      opts.kind,
    );
    // The watchdog already emitted an error + unstuck the UI on a stall; don't
    // also send `done` (which would flip the message status back from error).
    if (!stalled) {
      sendToRenderer("agent:event", {
        type: "done",
        payload: {},
      } satisfies AgentEvent);
    }
    resolveTurn({ stalled });
  };
  const failTurn = (err: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    log.error(`[agent:${project.agentId}] error:`, err);
    sendToRenderer("agent:event", {
      type: "error",
      payload: { message: err.message },
    } satisfies AgentEvent);
    rejectTurn(err);
  };

  const bump = (): void => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      log.error(
        `[agent:${project.agentId}] no output for ${idleMs}ms — killing stalled run`,
      );
      sendToRenderer("agent:event", {
        type: "error",
        payload: {
          message: `Agent stalled (no output for ${Math.round(idleMs / 1000)}s) and was stopped. Try again.`,
        },
      } satisfies AgentEvent);
      adapter.kill(child); // SIGTERM
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL"); // ignored SIGTERM → hard kill
        } catch {
          /* already gone */
        }
        // If even SIGKILL yields no `close` (zombie), force the turn to resolve.
        forceTimer = setTimeout(settle, STALL_GRACE_MS);
      }, STALL_GRACE_MS);
    }, idleMs);
  };

  const emit = (event: AgentEvent): void => {
    if (event.type === "session") {
      setAgentSessionId(session.id, event.payload.sessionId);
    } else if (event.type === "text_delta") {
      assistantText += event.payload.text;
    } else if (event.type === "tool_use" || event.type === "tool_result") {
      toolEvents.push(event);
      bump(); // a tool call is progress even when stdout then goes quiet
    } else if (event.type === "done" && event.payload.sessionId) {
      setAgentSessionId(session.id, event.payload.sessionId);
    }
    sendToRenderer("agent:event", event);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    bump();
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      for (const event of adapter.parseEvent(line)) emit(event);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    bump();
    log.warn(`[agent:${project.agentId}] stderr: ${chunk.toString()}`);
  });
  child.on("close", (code) => {
    log.info(`[agent:${project.agentId}] exited code=${code}`);
    settle();
  });
  child.on("error", (err) => failTurn(err));

  bump();
  return turn;
}

interface VisionOutcome {
  stalled: boolean;
  changed: boolean; // the agent edited the model → re-validate
  ranTurn: boolean; // a token-spending vision turn actually ran
}

/**
 * Render snapshots (always an iso thumbnail; iso/front/top when a vision check is
 * `warranted`) and, when warranted and renderable, run one vision turn. Returns
 * whether it stalled, edited the model, or spent a turn.
 */
async function runVision(
  ctx: TurnCtx,
  modelPath: string,
  sessionId: string,
  warranted: boolean,
): Promise<VisionOutcome> {
  const { project, projectId } = ctx;
  const cameras: CameraPreset[] = warranted ? ["iso", "front", "top"] : ["iso"];
  const pngs = await renderSnapshots(project, modelPath, cameras);
  if (!warranted || pngs.length === 0) {
    return { stalled: false, changed: false, ranTurn: false };
  }

  const before = await modelStat(project);
  sendStatus({ projectId, phase: "vision" });
  const visionPrompt = buildVisionPrompt({ modelPath, pngPaths: pngs });
  insertMessage(sessionId, "user", visionPrompt, undefined, "vision");
  const turn = await executeTurn(ctx, visionPrompt, {
    kind: "vision",
    includePreamble: false,
  });
  if (turn.stalled) return { stalled: true, changed: false, ranTurn: true };
  const after = await modelStat(project);
  return {
    stalled: false,
    changed: !!after && !unchanged(before, after),
    ranTurn: true,
  };
}

interface ModelStat {
  path: string;
  mtimeMs: number;
}

async function modelStat(project: ProjectRow): Promise<ModelStat | null> {
  const path = await latestModel(project);
  if (!path) return null;
  try {
    // Take the newest mtime across the entry + every part source, so a part-only
    // edit (entry untouched) still registers as a model change and runs the loop.
    const sources = [path, ...(await listPartSources(project))];
    const mtimes = await Promise.all(
      sources.map((p) =>
        stat(p)
          .then((s) => s.mtimeMs)
          .catch(() => 0),
      ),
    );
    return { path, mtimeMs: Math.max(...mtimes) };
  } catch {
    return null;
  }
}

/** True when the latest model is the same file, untouched by the turn. */
function unchanged(before: ModelStat | null, after: ModelStat): boolean {
  return (
    !!before && before.path === after.path && before.mtimeMs === after.mtimeMs
  );
}

function firstFailure(verdict: TurnVerdict): {
  gate: GateId;
  errors: string[];
  warnings: string[];
} {
  const failed = verdict.results.find((r) => r.status === "fail");
  const warnings = verdict.results.flatMap((r) => r.warnings);
  return {
    gate: failed?.gate ?? "validate",
    errors: failed?.errors ?? [],
    warnings,
  };
}

function failMessage(verdict: TurnVerdict): string {
  const errors = verdict.results
    .filter((r) => r.status === "fail")
    .flatMap((r) => r.errors);
  return errors.length
    ? errors.slice(0, 3).join("; ")
    : "Model failed automated validation.";
}

function sendStatus(payload: TurnStatusPayload): void {
  sendToRenderer("turn:status", payload);
}

function sendFailed(projectId: string, message: string): void {
  sendStatus({ projectId, phase: "failed", message });
  sendToRenderer("preview:error", { projectId, message });
}

function failStall(projectId: string): { stalled: boolean } {
  sendStatus({ projectId, phase: "failed", message: STALL_MSG });
  return { stalled: true };
}

/**
 * Execute a saved workflow's steps as sequential agent turns, starting at
 * `fromStep`. Each step is a full `runAgentTurn` (so chat/preview + self-repair
 * run as usual). A stalled step stops the run instead of silently advancing.
 */
export async function runWorkflow(
  projectId: string,
  slug: string,
  fromStep = 0,
): Promise<void> {
  const wf = getWorkflow(projectId, slug);
  const total = wf.steps.length;
  const send = (
    index: number,
    status: WorkflowStepPayload["status"],
    extra: Partial<WorkflowStepPayload> = {},
  ): void => {
    sendToRenderer("workflow:step", {
      projectId,
      slug,
      index,
      total,
      title: wf.steps[index]?.title ?? "",
      status,
      ...extra,
    } satisfies WorkflowStepPayload);
  };

  for (let i = Math.max(0, fromStep); i < total; i++) {
    const step = wf.steps[i];
    if (!step) break;
    send(i, "running");
    try {
      // Force a vision check on the final step (the workflow's deliverable).
      const verify = i === total - 1;
      const { stalled } = await runAgentTurn(
        projectId,
        step.prompt,
        undefined,
        verify,
      );
      if (stalled) {
        send(i, "error", { message: STALL_MSG });
        return;
      }
    } catch (err) {
      send(i, "error", {
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    send(i, "done");
    if (i < total - 1 && step.autoAdvance === false) {
      send(i, "paused", { nextStep: i + 1 });
      return;
    }
  }
  send(Math.max(0, total - 1), "finished");
}
