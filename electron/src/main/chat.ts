import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { initDb } from "./db/index.js";
import { messages, sessions } from "./db/schema.js";
import type { ChatMessageRecord } from "../../../shared/ipc.js";

/** One session per project for v0.x. Returns the existing row or creates one. */
export function getOrCreateSession(
  projectId: string,
  agentId: string,
): typeof sessions.$inferSelect {
  const db = initDb();
  const [existing] = db
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .all();
  if (existing) return existing;

  const row = {
    id: randomUUID(),
    projectId,
    agentId,
    agentSessionId: null,
    createdAt: new Date(),
  };
  db.insert(sessions).values(row).run();
  return row;
}

/**
 * Rebind a project's session to a new agent, dropping any resume id (the old
 * id belongs to the previous CLI and can't carry context across agents).
 * No-op if the project has no session yet.
 */
export function resetSessionAgent(projectId: string, agentId: string): void {
  initDb()
    .update(sessions)
    .set({ agentId, agentSessionId: null })
    .where(eq(sessions.projectId, projectId))
    .run();
}

export function setAgentSessionId(
  sessionId: string,
  agentSessionId: string,
): void {
  initDb()
    .update(sessions)
    .set({ agentSessionId })
    .where(eq(sessions.id, sessionId))
    .run();
}

export function insertMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  eventsJson?: string,
): void {
  initDb()
    .insert(messages)
    .values({
      id: randomUUID(),
      sessionId,
      role,
      content,
      eventsJson: eventsJson ?? null,
      createdAt: new Date(),
    })
    .run();
}

/** Ordered chat history for a project (empty if no session yet). */
export function listMessages(projectId: string): ChatMessageRecord[] {
  const db = initDb();
  const [session] = db
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .all();
  if (!session) return [];

  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, session.id))
    .orderBy(asc(messages.createdAt))
    .all()
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      eventsJson: m.eventsJson ?? undefined,
    }));
}
