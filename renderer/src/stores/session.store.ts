import { create } from "zustand";

interface Session {
  id: string;
  projectId: string;
  agentId: string;
  createdAt: Date;
}

interface SessionStore {
  sessions: Record<string, Session>;
  activeSessionId: string | null;
  setActive(id: string | null): void;
  addSession(session: Session): void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: {},
  activeSessionId: null,

  setActive(id) {
    set({ activeSessionId: id });
  },

  addSession(session) {
    set((s) => ({ sessions: { ...s.sessions, [session.id]: session } }));
  },
}));
