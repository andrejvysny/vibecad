import { create } from "zustand";
import type { AgentEvent, DetectedAgent } from "@shared/types";
import type { SelectionFeedback, TurnStatusPayload } from "@shared/ipc";
import { useProjectStore } from "./project.store";
import { latestModelBase } from "./preview";

type TurnKind = "chat" | "repair" | "vision";

/** Headline for a collapsed auto-turn, derived from its persisted prompt. */
function deriveLabel(content: string, kind: TurnKind): string {
  if (kind === "vision") return "👁 Vision check";
  const m = /repair attempt (\d+)\/(\d+)/.exec(content);
  return m ? `🔧 Auto-repair pass ${m[1]}/${m[2]}` : "🔧 Auto-repair";
}

export interface ToolCard {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  isError?: boolean;
}

/** A model produced by an assistant turn, surfaced inline in the chat. */
export interface ResultRef {
  modelBase: string;
  // Absolute path to a render thumbnail (iso/front/top png), if one exists.
  thumbPath?: string;
  hasStl: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolCard[];
  status: "streaming" | "done" | "error";
  attachments?: string[];
  result?: ResultRef;
  kind?: TurnKind;
  // Set on app-injected repair/vision user messages → rendered collapsed.
  collapsedLabel?: string;
}

/** Snapshot the active project's newest model as an inline result, if any. */
function captureResult(): ResultRef | undefined {
  const project = useProjectStore.getState().activeProject;
  if (!project) return undefined;
  const base = latestModelBase(project.files);
  if (!base) return undefined;
  const thumb = ["iso", "front", "top"]
    .map((a) => `${base}_${a}.png`)
    .find((f) => project.files.includes(f));
  const hasStl = project.files.includes(`${base}.stl`);
  if (!thumb && !hasStl) return undefined;
  return {
    modelBase: base,
    thumbPath: thumb ? `${project.dir}/${thumb}` : undefined,
    hasStl,
  };
}

interface RunPayload {
  prompt: string;
  projectId: string;
  attachments?: string[];
  // Force a vision-in-the-loop check this turn (composer "Verify" toggle).
  verify?: boolean;
  // Pins/region the user marked on the 3D model this turn.
  selection?: SelectionFeedback;
  // Multi-part edit scope: part files to restrict edits to this turn.
  editScope?: string[];
}

interface AgentStore {
  detected: DetectedAgent[];
  activeAgentId: string | null;
  running: boolean;
  messages: ChatMessage[];
  // Live phase of the post-turn accuracy pipeline (validate/repair/escalate).
  turnStatus: TurnStatusPayload | null;
  detect(): Promise<void>;
  run(payload: RunPayload): Promise<void>;
  stop(projectId: string): Promise<void>;
  pushEvent(event: AgentEvent): void;
  setTurnStatus(status: TurnStatusPayload): void;
  loadHistory(projectId: string): Promise<void>;
  // Back-fill the last assistant turn's inline result once its files land
  // (the agent's render PNG/STL may appear after the `done` event).
  refreshLastResult(): void;
  clear(): void;
}

const uid = (): string => crypto.randomUUID();

// Reconstruct an assistant turn's tool timeline from persisted events JSON.
function hydrateTools(eventsJson?: string): ToolCard[] {
  if (!eventsJson) return [];
  let events: AgentEvent[];
  try {
    events = JSON.parse(eventsJson) as AgentEvent[];
  } catch {
    return [];
  }
  const tools: ToolCard[] = [];
  for (const ev of events) {
    if (ev.type === "tool_use") {
      tools.push({
        id: ev.payload.id,
        name: ev.payload.name,
        input: ev.payload.input,
      });
    } else if (ev.type === "tool_result") {
      const card = tools.find((t) => t.id === ev.payload.toolUseId);
      if (card) {
        card.result = ev.payload.content;
        card.isError = ev.payload.isError;
      }
    }
  }
  return tools;
}

// ── rAF-batched text deltas ──────────────────────────────────────────────────
// Buffer text between animation frames so fast streaming doesn't thrash React.
let pendingText = "";
let rafHandle: number | null = null;

export const useAgentStore = create<AgentStore>((set, get) => {
  // Apply buffered text to the trailing streaming assistant message.
  const flushText = (): void => {
    rafHandle = null;
    if (!pendingText) return;
    const chunk = pendingText;
    pendingText = "";
    set((s) => ({
      messages: patchLast(s.messages, (m) => ({ ...m, text: m.text + chunk })),
    }));
  };

  return {
    detected: [],
    activeAgentId: null,
    running: false,
    messages: [],
    turnStatus: null,

    async detect() {
      const agents = await window.api.detectAgents();
      const active = agents.find((a) => a.available);
      set({ detected: agents, activeAgentId: active?.id ?? null });
    },

    async run({
      prompt,
      projectId,
      attachments,
      verify,
      selection,
      editScope,
    }) {
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        text: prompt,
        tools: [],
        status: "done",
        attachments,
      };
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: "",
        tools: [],
        status: "streaming",
      };
      set((s) => ({
        running: true,
        turnStatus: null,
        messages: [...s.messages, userMsg, assistantMsg],
      }));
      try {
        await window.api.runAgent({
          prompt,
          projectId,
          attachments,
          verify,
          selection,
          editScope,
        });
      } catch (err) {
        get().pushEvent({
          type: "error",
          payload: {
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        // The whole self-repair loop has resolved; the run() owns `running`
        // (inner repair turns each emit `done`, which must NOT re-enable input).
        set({ running: false, turnStatus: null });
      }
    },

    async stop(projectId) {
      await window.api.stopAgent({ projectId });
      set((s) => ({
        running: false,
        turnStatus: null,
        messages: patchLast(s.messages, (m) =>
          m.status === "streaming" ? { ...m, status: "done" } : m,
        ),
      }));
    },

    pushEvent(event) {
      switch (event.type) {
        case "text_delta":
          pendingText += event.payload.text;
          if (rafHandle === null) rafHandle = requestAnimationFrame(flushText);
          return;
        case "tool_use": {
          flushText();
          const card: ToolCard = {
            id: event.payload.id,
            name: event.payload.name,
            input: event.payload.input,
          };
          set((s) => ({
            messages: patchLast(s.messages, (m) => ({
              ...m,
              tools: [...m.tools, card],
            })),
          }));
          return;
        }
        case "tool_result":
          flushText();
          set((s) => ({
            messages: patchLast(s.messages, (m) => ({
              ...m,
              tools: m.tools.map((t) =>
                t.id === event.payload.toolUseId
                  ? {
                      ...t,
                      result: event.payload.content,
                      isError: event.payload.isError,
                    }
                  : t,
              ),
            })),
          }));
          return;
        case "done": {
          // One `done` arrives per turn (chat + each repair). It finalizes the
          // trailing assistant bubble but must NOT clear `running` — the loop
          // may still spawn repair turns; run()'s finally owns `running`.
          flushText();
          const result = captureResult();
          set((s) => ({
            messages: patchLast(s.messages, (m) => ({
              ...m,
              status: "done",
              result: result ?? m.result,
            })),
          }));
          return;
        }
        case "error":
          flushText();
          set((s) => ({
            running: false,
            messages: patchLast(s.messages, (m) => ({
              ...m,
              status: "error",
              text:
                m.text + (m.text ? "\n\n" : "") + `⚠ ${event.payload.message}`,
            })),
          }));
          return;
        default:
          return; // session / raw: not surfaced
      }
    },

    setTurnStatus(status) {
      // A repair/escalation turn gets its own collapsed user line + a fresh
      // assistant bubble so its output doesn't merge into the prior turn.
      if (status.phase === "repairing" || status.phase === "escalating") {
        const collapsedLabel =
          status.phase === "escalating"
            ? `⏫ ${status.message ?? "Escalating model"}`
            : `🔧 Auto-repair pass ${status.attempt}/${status.maxAttempts}`;
        const repairUser: ChatMessage = {
          id: uid(),
          role: "user",
          text: status.gate
            ? `${status.gate} gate failed — auto-repairing.`
            : "Auto-repairing.",
          tools: [],
          status: "done",
          kind: "repair",
          collapsedLabel,
        };
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          text: "",
          tools: [],
          status: "streaming",
        };
        set((s) => ({
          turnStatus: status,
          messages: [...s.messages, repairUser, assistantMsg],
        }));
        return;
      }
      set({ turnStatus: status });
    },

    async loadHistory(projectId) {
      const records = await window.api.chatHistory({ projectId });
      set({
        messages: records
          .filter((r) => r.role !== "tool")
          .map((r) => {
            const kind = (r.kind ?? "chat") as TurnKind;
            const auto = r.role === "user" && kind !== "chat";
            return {
              id: r.id,
              role: r.role as "user" | "assistant",
              text: r.content,
              tools: r.role === "assistant" ? hydrateTools(r.eventsJson) : [],
              status: "done" as const,
              kind,
              ...(auto ? { collapsedLabel: deriveLabel(r.content, kind) } : {}),
            };
          }),
      });
    },

    refreshLastResult() {
      const last = [...get().messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (!last || last.status === "streaming" || last.result) return;
      const result = captureResult();
      if (!result) return;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === last.id ? { ...m, result } : m,
        ),
      }));
    },

    clear() {
      set({ messages: [] });
    },
  };
});

/** Replace the trailing assistant message via `fn` (no-op if none streaming). */
function patchLast(
  messages: ChatMessage[],
  fn: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      const next = messages.slice();
      next[i] = fn(messages[i]!);
      return next;
    }
  }
  return messages;
}
