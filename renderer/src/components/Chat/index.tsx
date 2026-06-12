import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAgentStore,
  type ChatMessage,
  type ToolCard,
} from "../../stores/agent.store";
import { studioUrl } from "../../lib/studio";
import type { Project } from "../../stores/project.store";

interface Props {
  project: Project | null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fileUrl(path: string): string {
  return studioUrl(path);
}

export function Chat({ project }: Props) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const { messages, running, run, stop } = useAgentStore();
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

  function handleSend() {
    if (!prompt.trim() || !project) return;
    void run({ prompt: prompt.trim(), projectId: project.id, attachments });
    setPrompt("");
    setAttachments([]);
  }

  async function handlePick() {
    if (!project) return;
    const paths = await window.api.pickImages({ projectId: project.id });
    setAttachments((a) => [...a, ...paths]);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wide">
        Chat
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
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="p-3 border-t border-white/10">
        {!project && (
          <p className="text-xs text-gray-500 mb-2">
            Open or create a project to start
          </p>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((path) => (
              <div key={path} className="relative">
                <img
                  src={fileUrl(path)}
                  alt=""
                  className="w-12 h-12 object-cover rounded border border-white/10"
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
        <div className="flex gap-2">
          <textarea
            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm resize-none text-gray-100 placeholder-gray-500 focus:outline-none focus:border-white/30"
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
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
            }}
          />
          <div className="flex flex-col gap-1">
            {running ? (
              <button
                onClick={() => project && void stop(project.id)}
                className="px-3 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-xs hover:bg-red-500/30"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!project || !prompt.trim()}
                className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 disabled:opacity-40"
              >
                Send
              </button>
            )}
            <button
              onClick={() => void handlePick()}
              disabled={!project}
              title="Attach image"
              className="px-3 py-1 border border-white/10 rounded text-xs text-gray-400 hover:border-white/30 disabled:opacity-40"
            >
              📎
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          ⌘↵ to send · paste or drop images
        </p>
      </div>
    </div>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
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
                src={fileUrl(p)}
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
      {message.tools.map((t) => (
        <ToolCardView key={t.id} tool={t} />
      ))}
      {message.text && (
        <div
          className={`whitespace-pre-wrap leading-relaxed ${isError ? "text-red-400" : "text-gray-200"}`}
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
            Thinking…
          </div>
        )}
    </div>
  );
}

function ToolCardView({ tool }: { tool: ToolCard }) {
  const pending = tool.result === undefined;
  const dot = tool.isError
    ? "bg-red-400"
    : pending
      ? "bg-blue-400 animate-pulse"
      : "bg-green-400";
  const target =
    tool.input && typeof tool.input === "object"
      ? ((tool.input as Record<string, unknown>)["file_path"] ??
        (tool.input as Record<string, unknown>)["path"] ??
        (tool.input as Record<string, unknown>)["command"])
      : undefined;
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-gray-300">{tool.name}</span>
      {typeof target === "string" && (
        <span className="text-gray-500 truncate max-w-[200px]">{target}</span>
      )}
    </div>
  );
}
