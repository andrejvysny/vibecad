import { create } from "zustand";
import type { AgentEvent, DetectedAgent } from "@shared/types";

interface AgentStore {
  detected: DetectedAgent[];
  activeAgentId: string | null;
  running: boolean;
  events: AgentEvent[];
  detect(): Promise<void>;
  run(payload: {
    prompt: string;
    projectId: string;
    sessionId?: string;
  }): Promise<void>;
  stop(projectId: string): Promise<void>;
  pushEvent(event: AgentEvent): void;
  clearEvents(): void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  detected: [],
  activeAgentId: null,
  running: false,
  events: [],

  async detect() {
    const agents = await window.api.detectAgents();
    const active = agents.find((a) => a.available);
    set({ detected: agents, activeAgentId: active?.id ?? null });
  },

  async run(payload) {
    set({ running: true, events: [] });
    try {
      await window.api.runAgent(payload);
    } finally {
      set({ running: false });
    }
  },

  async stop(projectId) {
    await window.api.stopAgent({ projectId });
    set({ running: false });
  },

  pushEvent(event) {
    if (event.type === "done") {
      set((s) => ({ events: [...s.events, event], running: false }));
    } else {
      set((s) => ({ events: [...s.events, event] }));
    }
    void get;
  },

  clearEvents() {
    set({ events: [] });
  },
}));
