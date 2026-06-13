import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAgentStore,
  type ChatMessage,
  type ResultRef,
  type ToolCard,
} from "../../stores/agent.store";
import { useProjectStore } from "../../stores/project.store";
import { useViewStore } from "../../stores/view.store";
import { studioUrl } from "../../lib/studio";
import { cn } from "../../lib/cn";
import { Chip, IconButton } from "../ui";
import type { Project } from "../../stores/project.store";
import { AGENT_MODELS, type AgentId } from "@shared/types";
import type { TurnStatusPayload } from "@shared/ipc";

interface Props {
  project: Project | null;
}

// Generic, model-agnostic follow-up prompts shown once a model exists.
const QUICK_ACTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: "Thicker walls",
    prompt: "Increase the wall thickness of the current model.",
  },
  { label: "Add a lid", prompt: "Add a closed lid to the current model." },
  {
    label: "Round corners",
    prompt: "Round/fillet the outer corners of the current model.",
  },
  {
    label: "Mounting holes",
    prompt: "Add mounting holes to the base of the current model.",
  },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function Chat({ project }: Props) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [verify, setVerify] = useState(false);
  const { messages, running, run, stop, detected, turnStatus } =
    useAgentStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addImageFiles = useCallback(
    async (files: File[]) => {
      if (!project) return;
      const images = files.filter((f) => f.type.startsWith("image/"));
      for (const f of images) {
        const dataBase64 = await fileToBase64(f);
        const path = await window.api.saveAttachment({
          projectId: project.id,
          name: f.name,
          dataBase64,
        });
        setAttachments((a) => [...a, path]);
      }
    },
    [project],
  );

  function send(text: string) {
    if (!text.trim() || !project) return;
    void run({
      prompt: text.trim(),
      projectId: project.id,
      attachments,
      verify,
    });
    setPrompt("");
    setAttachments([]);
  }

  async function handlePick() {
    if (!project) return;
    const paths = await window.api.pickImages({ projectId: project.id });
    setAttachments((a) => [...a, ...paths]);
  }

  const hasModel = !!project?.activeModel;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          Chat
        </span>
        <div className="flex items-center gap-1.5">
          <AgentSwitcher
            project={project}
            detected={detected}
            disabled={running}
          />
          <ModelSwitcher project={project} disabled={running} />
        </div>
      </div>

      {/* Message stream */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-4 text-sm"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addImageFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {messages.length === 0 && (
          <p className="text-gray-600 text-xs">
            {project
              ? "Describe what to model to get started."
              : "Open or create a project."}
          </p>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} />
        ))}
        {running && turnStatus && <TurnStatusChip status={turnStatus} />}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="p-3 border-t border-white/10">
        {!project && (
          <p className="text-xs text-gray-500 mb-2">
            Open or create a project to start
          </p>
        )}
        {hasModel && !running && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {QUICK_ACTIONS.map((a) => (
              <Chip
                key={a.label}
                onClick={() => send(a.prompt)}
                title={a.prompt}
              >
                {a.label}
              </Chip>
            ))}
          </div>
        )}

        {/* One enclosed input surface: attachments + textarea + action bar. */}
        <div
          className={cn(
            "rounded-xl border bg-white/[0.03] transition-colors",
            project
              ? "border-white/10 focus-within:border-white/25 focus-within:bg-white/[0.05]"
              : "border-white/5 opacity-60",
          )}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2.5 pt-2.5">
              {attachments.map((path) => (
                <div key={path} className="relative">
                  <img
                    src={studioUrl(path)}
                    alt=""
                    className="w-12 h-12 object-cover rounded-md border border-white/10"
                  />
                  <button
                    onClick={() =>
                      setAttachments((a) => a.filter((p) => p !== path))
                    }
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black/80 border border-white/20 text-[10px] leading-none text-gray-300 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="w-full bg-transparent px-3 pt-2.5 pb-1 text-sm leading-relaxed resize-none text-gray-100 placeholder-gray-500 focus:outline-none disabled:cursor-not-allowed"
            rows={3}
            placeholder="Describe what to model…"
            value={prompt}
            disabled={!project}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) void addImageFiles(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(prompt);
            }}
          />

          {/* Action bar: attach · verify · hint · send/stop */}
          <div className="flex items-center gap-2 px-2 pb-2">
            <IconButton
              onClick={() => void handlePick()}
              disabled={!project}
              title="Attach image"
              className="shrink-0"
            >
              <PaperclipIcon />
            </IconButton>
            <button
              type="button"
              onClick={() => setVerify((v) => !v)}
              disabled={!project}
              title="Render the model and have the agent visually verify it against your request"
              className={cn(
                "shrink-0 px-2 py-0.5 rounded text-[11px] border transition-colors disabled:opacity-40",
                verify
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-white/10 text-gray-500 hover:text-gray-300",
              )}
            >
              👁 Verify
            </button>
            <span className="flex-1 min-w-0 truncate text-[11px] text-gray-600 select-none">
              <kbd className="font-sans text-gray-500">⌘↵</kbd> to send · paste
              or drop images
            </span>
            {running ? (
              <button
                onClick={() => project && void stop(project.id)}
                className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/90 text-white text-xs font-medium hover:bg-red-500 transition-colors"
              >
                <StopIcon />
                Stop
              </button>
            ) : (
              <button
                onClick={() => send(prompt)}
                disabled={!project || !prompt.trim()}
                className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-medium hover:bg-blue-400 disabled:bg-white/10 disabled:text-gray-500 transition-colors"
              >
                Send
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Per-project agent selector. Lists every detected agent; unavailable ones are
// disabled with a hint. Switching persists to the project and resets the
// agent's CLI session (handled main-side) — displayed history is kept.
function AgentSwitcher({
  project,
  detected,
  disabled,
}: {
  project: Project | null;
  detected: ReadonlyArray<{ id: AgentId; name: string; available: boolean }>;
  disabled: boolean;
}) {
  if (!project || detected.length === 0) return null;
  return (
    <select
      value={project.agentId}
      disabled={disabled}
      title={
        disabled ? "Stop the current run to switch agents" : "Agent backend"
      }
      onChange={(e) =>
        void useProjectStore
          .getState()
          .setProjectAgent(project.id, e.target.value as AgentId)
      }
      className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-white/30 disabled:opacity-40"
    >
      {detected.map((a) => (
        <option key={a.id} value={a.id} disabled={!a.available}>
          {a.name}
          {a.available ? "" : " (not found)"}
        </option>
      ))}
    </select>
  );
}

// Per-project model selector for the bound agent. Presets come from
// AGENT_MODELS; "Default" (empty value) clears the override so the CLI uses its
// own configured model. Switching the agent resets this (handled in the store).
function ModelSwitcher({
  project,
  disabled,
}: {
  project: Project | null;
  disabled: boolean;
}) {
  if (!project) return null;
  const models = AGENT_MODELS[project.agentId as AgentId];
  if (!models) return null;
  return (
    <select
      value={project.agentModel ?? ""}
      disabled={disabled}
      title={disabled ? "Stop the current run to switch model" : "Model"}
      onChange={(e) =>
        void useProjectStore
          .getState()
          .setProjectModel(project.id, e.target.value)
      }
      className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-white/30 disabled:opacity-40"
    >
      {models.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

// Counts up once per second from mount — gives a streaming turn a visible
// heartbeat so a long, quiet round-trip doesn't read as frozen.
function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{s}s</span>;
}

function MessageView({ message }: { message: ChatMessage }) {
  if (message.collapsedLabel) return <CollapsedAuto message={message} />;
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] bg-blue-500/15 border border-blue-500/20 rounded-lg px-3 py-1.5 text-gray-100 whitespace-pre-wrap">
          {message.text}
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end">
            {message.attachments.map((p) => (
              <img
                key={p}
                src={studioUrl(p)}
                alt=""
                className="w-12 h-12 object-cover rounded border border-white/10"
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isError = message.status === "error";
  return (
    <div className="space-y-1.5">
      {message.tools.length > 0 && (
        <ToolStrip
          tools={message.tools}
          streaming={message.status === "streaming"}
        />
      )}
      {message.text && (
        <div
          className={cn(
            "whitespace-pre-wrap leading-relaxed",
            isError ? "text-red-400" : "text-gray-200",
          )}
        >
          {message.text}
          {message.status === "streaming" && (
            <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-gray-400 animate-pulse" />
          )}
        </div>
      )}
      {!message.text &&
        message.status === "streaming" &&
        message.tools.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
            Thinking… <Elapsed />
          </div>
        )}
      {message.status === "streaming" &&
        (message.text !== "" || message.tools.length > 0) && (
          <div className="text-[11px] text-gray-600">
            working… <Elapsed />
          </div>
        )}
      {message.result && <ResultCard result={message.result} />}
    </div>
  );
}

// ── Auto-repair / vision turns ───────────────────────────────────────────────
// App-injected turns collapse to a single expandable line so they don't clutter
// the conversation with prompts the user didn't write.

function CollapsedAuto({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/[0.06] text-[11px] text-amber-300/90 hover:border-amber-500/40"
      >
        <Chevron open={open} />
        {message.collapsedLabel}
      </button>
      {open && message.text && (
        <div className="max-w-[85%] text-[11px] text-gray-500 whitespace-pre-wrap text-right">
          {message.text}
        </div>
      )}
    </div>
  );
}

// Live status of the post-turn accuracy pipeline, shown under the last message.
function TurnStatusChip({ status }: { status: TurnStatusPayload }) {
  const text = chipText(status);
  if (!text) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-amber-400/90">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      {text}
    </div>
  );
}

function chipText(s: TurnStatusPayload): string | null {
  switch (s.phase) {
    case "validating":
      return "Validating geometry…";
    case "rendering":
      return "Rendering…";
    case "repairing":
      return `Repairing… (pass ${s.attempt}/${s.maxAttempts})`;
    case "escalating":
      return s.message ?? "Escalating to a stronger model…";
    case "vision":
      return "Visual check…";
    default:
      return null; // ok / failed are surfaced inline
  }
}

// ── Tool strip ───────────────────────────────────────────────────────────────
// Collapse an assistant turn's plumbing into one line; expand on demand.

function ToolStrip({
  tools,
  streaming,
}: {
  tools: ToolCard[];
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const done = tools.filter((t) => t.result !== undefined).length;
  // A non-zero exit that the agent kept going past is a recoverable probe,
  // not a user-facing failure — count it but never paint it red.
  const recovered = tools.filter((t) => t.isError).length;

  return (
    <div className="rounded border border-white/5 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
      >
        <Chevron open={open} />
        {streaming && done < tools.length ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span>
              Working…{" "}
              <span className="text-gray-500">
                ({done}/{tools.length})
              </span>
            </span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span>
              {tools.length} step{tools.length === 1 ? "" : "s"}
            </span>
          </>
        )}
        {recovered > 0 && (
          <span
            className="text-amber-400/80"
            title="recovered from non-zero exits"
          >
            · {recovered} retried
          </span>
        )}
      </button>
      {open && (
        <div className="px-2 pb-1.5 space-y-0.5">
          {tools.map((t) => (
            <ToolRow key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolCard }) {
  const pending = tool.result === undefined;
  const dot = pending
    ? "bg-blue-400 animate-pulse"
    : tool.isError
      ? "bg-amber-400"
      : "bg-green-400";
  const { label, full } = describeTool(tool);
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400" title={full}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
      <span className="text-gray-300 w-10 shrink-0">{tool.name}</span>
      <span className="text-gray-500 truncate">{label}</span>
    </div>
  );
}

// Pull a readable, basename-preserving label out of a tool's input.
function describeTool(tool: ToolCard): { label: string; full: string } {
  const input = tool.input;
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    const path = rec["file_path"] ?? rec["path"];
    if (typeof path === "string") {
      const base = path.slice(path.lastIndexOf("/") + 1);
      return { label: base, full: path };
    }
    const cmd = rec["command"];
    if (typeof cmd === "string") return { label: cmd, full: cmd };
  }
  return { label: "", full: "" };
}

// ── Inline result card ───────────────────────────────────────────────────────

function ResultCard({ result }: { result: ResultRef }) {
  const project = useProjectStore((s) => s.activeProject);
  function view() {
    if (!project) return;
    useProjectStore.getState().setActiveModel(project.id, result.modelBase);
    useViewStore.getState().show3d();
  }
  return (
    <button
      onClick={view}
      className="group flex items-center gap-3 w-full mt-1 p-2 rounded-lg border border-white/10 bg-white/[0.02] hover:border-white/25 text-left"
    >
      {result.thumbPath ? (
        <img
          src={studioUrl(result.thumbPath)}
          alt={result.modelBase}
          className="w-14 h-14 rounded object-cover bg-[#0a0d12] shrink-0"
        />
      ) : (
        <div className="w-14 h-14 rounded grid place-items-center bg-[#0a0d12] text-gray-600 shrink-0">
          <CubeIcon />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-sm text-gray-200 truncate">{result.modelBase}</div>
        <div className="text-xs text-blue-400 group-hover:text-blue-300">
          View in 3D →
        </div>
      </div>
    </button>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className={cn("transition-transform shrink-0", open && "rotate-90")}
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      <path
        d="M12 19V5m0 0l-6 6m6-6l6 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        d="M21 11.5l-8.5 8.5a5 5 0 01-7-7l8.5-8.5a3.3 3.3 0 014.7 4.7L10 17.5a1.7 1.7 0 01-2.3-2.3L15 8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d="M21 7.5l-9-5-9 5m18 0l-9 5m9-5v9l-9 5m0-9l-9-5m9 5v9m-9-14v9l9 5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
