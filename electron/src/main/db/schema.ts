import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dir: text("dir").notNull(),
  agentId: text("agent_id").notNull(),
  modelingBackend: text("modeling_backend")
    .notNull()
    .$type<"openscad" | "build123d">(),
  outputNeed: text("output_need").notNull().$type<"print" | "cad">(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  agentId: text("agent_id").notNull(),
  // The CLI's own session id, used to resume the conversation (--resume).
  agentSessionId: text("agent_session_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  role: text("role").notNull().$type<"user" | "assistant" | "tool">(),
  content: text("content").notNull(),
  // Assistant turn's serialized tool timeline (JSON) for reload.
  eventsJson: text("events_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  sessionId: text("session_id"),
  filename: text("filename").notNull(),
  ext: text("ext").notNull().$type<".scad" | ".py">(),
  version: integer("version").notNull(),
  prompt: text("prompt"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const exports = sqliteTable("exports", {
  id: text("id").primaryKey(),
  modelId: text("model_id")
    .notNull()
    .references(() => models.id),
  format: text("format").notNull().$type<"stl" | "3mf" | "step" | "dxf">(),
  path: text("path").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
