import { useEffect } from "react";
import { useAgentStore } from "../../stores/agent.store";
import { useBackendStore } from "../../stores/backend.store";

export function Settings() {
  const { detected: agents, detect: detectAgents } = useAgentStore();
  const { detected: backends, detect: detectBackends } = useBackendStore();

  useEffect(() => {
    void detectAgents();
    void detectBackends();
  }, [detectAgents, detectBackends]);

  return (
    <div className="p-4 space-y-6 text-sm">
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Agent Backends
        </h2>
        <div className="space-y-2">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-3">
              <span className={a.available ? "text-green-400" : "text-red-400"}>
                {a.available ? "✓" : "✗"}
              </span>
              <span className="text-gray-200">{a.name}</span>
              <span className="text-gray-500 text-xs truncate">
                {a.path || "not found"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Modeling Backends
        </h2>
        <div className="space-y-2">
          {backends.map((b) => (
            <div key={b.id} className="flex items-start gap-3">
              <span
                className={b.available ? "text-green-400" : "text-yellow-400"}
              >
                {b.available ? "✓" : "⚠"}
              </span>
              <div>
                <div className="text-gray-200">{b.name}</div>
                <div className="text-gray-500 text-xs">{b.detail}</div>
                {b.missing && b.missing.length > 0 && (
                  <div className="text-red-400 text-xs mt-0.5">
                    missing: {b.missing.join(", ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            void detectAgents();
            void detectBackends();
          }}
          className="mt-3 px-3 py-1 text-xs border border-white/10 rounded text-gray-400 hover:border-white/30"
        >
          Rescan
        </button>
      </section>
    </div>
  );
}
