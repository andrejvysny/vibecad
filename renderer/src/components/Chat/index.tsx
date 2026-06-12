import { useState, useRef, useEffect } from "react";
import { useAgentStore } from "../../stores/agent.store";
import type { Project } from "../../stores/project.store";

interface Props {
  project: Project | null;
}

export function Chat({ project }: Props) {
  const [prompt, setPrompt] = useState("");
  const { events, running, run, stop } = useAgentStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  function handleSend() {
    if (!prompt.trim() || !project) return;
    void run({ prompt: prompt.trim(), projectId: project.id });
    setPrompt("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-gray-400 uppercase tracking-wide">
        Chat
      </div>

      {/* Event stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {events.map((ev, i) => {
          if (ev.type === "text_delta") {
            const text =
              typeof ev.payload === "string"
                ? ev.payload
                : (((ev.payload as Record<string, unknown>)?.[
                    "content"
                  ] as string) ?? "");
            return (
              <div
                key={i}
                className="text-gray-200 whitespace-pre-wrap leading-relaxed"
              >
                {text}
              </div>
            );
          }
          if (ev.type === "tool_use") {
            const name =
              ((ev.payload as Record<string, unknown>)?.["name"] as string) ??
              "tool";
            return (
              <div
                key={i}
                className="flex items-center gap-2 text-xs text-blue-400"
              >
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                {name}
              </div>
            );
          }
          if (ev.type === "done") {
            return (
              <div
                key={i}
                className="flex items-center gap-2 text-xs text-green-400"
              >
                <span>✓ Done</span>
              </div>
            );
          }
          return null;
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/10">
        {!project && (
          <p className="text-xs text-gray-500 mb-2">
            Open or create a project to start
          </p>
        )}
        <div className="flex gap-2">
          <textarea
            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm resize-none text-gray-100 placeholder-gray-500 focus:outline-none focus:border-white/30"
            rows={3}
            placeholder="Describe what to model…"
            value={prompt}
            disabled={!project}
            onChange={(e) => setPrompt(e.target.value)}
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
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-1">⌘↵ to send</p>
      </div>
    </div>
  );
}
