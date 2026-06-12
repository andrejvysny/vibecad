import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { initDb } from "./db/index.js";
import { exports, messages, models, projects, sessions } from "./db/schema.js";
import { detectBackends } from "./modeling/index.js";
import { getSkillsDir } from "./paths.js";
import type { AgentId, BackendId } from "../../../shared/types.js";

export interface CreateProjectInput {
  name: string;
  agentId: AgentId;
  modelingBackend: BackendId;
  outputNeed: "print" | "cad";
}

export type ProjectRow = typeof projects.$inferSelect;

/** Root dir for project folders (spec §15.1). */
export function getWorkspaceRoot(): string {
  const root = join(homedir(), "openscad-studio", "projects");
  mkdirSync(root, { recursive: true });
  return root;
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectRow> {
  // Spec §7: block creation if the chosen backend isn't available.
  const backends = await detectBackends();
  const status = backends.find((b) => b.id === input.modelingBackend);
  if (!status?.available) {
    const missing = status?.missing?.join(", ") || "unknown dependencies";
    throw new Error(
      `Backend "${input.modelingBackend}" unavailable (missing: ${missing}). ` +
        `Install the dependencies via Settings → Modeling backends.`,
    );
  }

  const id = randomUUID();
  const dir = join(getWorkspaceRoot(), id);
  mkdirSync(dir, { recursive: true });

  // Copy the backend skill into the project (spec §11/§15.1). The agent is
  // also pointed at the bundled skill dir directly via getSkillsDir().
  const skillDest = join(dir, ".studio", "skills", input.modelingBackend);
  mkdirSync(skillDest, { recursive: true });
  cpSync(getSkillsDir(input.modelingBackend), skillDest, { recursive: true });

  const now = new Date();
  const row: ProjectRow = {
    id,
    name: input.name,
    dir,
    agentId: input.agentId,
    agentModel: null,
    modelingBackend: input.modelingBackend,
    outputNeed: input.outputNeed,
    createdAt: now,
    updatedAt: now,
  };

  initDb().insert(projects).values(row).run();
  return row;
}

export function listProjects(): ProjectRow[] {
  return initDb().select().from(projects).all();
}

export function getProject(id: string): ProjectRow | undefined {
  const [row] = initDb()
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .all();
  return row;
}

export function renameProject(id: string, name: string): ProjectRow {
  const db = initDb();
  db.update(projects)
    .set({ name, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .run();
  const row = getProject(id);
  if (!row) throw new Error(`Project not found: ${id}`);
  return row;
}

/** Switch the agent backend bound to a project (spec: per-project, mutable).
 *  Clears the model selection — model strings are agent-specific, so a value
 *  picked for the old agent would be meaningless (or wrong) for the new one. */
export function setProjectAgent(id: string, agentId: AgentId): ProjectRow {
  const db = initDb();
  db.update(projects)
    .set({ agentId, agentModel: null, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .run();
  const row = getProject(id);
  if (!row) throw new Error(`Project not found: ${id}`);
  return row;
}

/** Set (or clear, on empty string) the CLI model for a project's agent. */
export function setProjectModel(id: string, model: string): ProjectRow {
  const db = initDb();
  db.update(projects)
    .set({ agentModel: model || null, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .run();
  const row = getProject(id);
  if (!row) throw new Error(`Project not found: ${id}`);
  return row;
}

/** Cascade-delete a project's DB rows (FK-safe order) and remove its dir. */
export function deleteProject(id: string): void {
  const db = initDb();
  const row = getProject(id);
  if (!row) throw new Error(`Project not found: ${id}`);

  db.transaction((tx) => {
    const sessIds = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.projectId, id))
      .all()
      .map((s) => s.id);
    const modelIds = tx
      .select({ id: models.id })
      .from(models)
      .where(eq(models.projectId, id))
      .all()
      .map((m) => m.id);

    if (sessIds.length)
      tx.delete(messages).where(inArray(messages.sessionId, sessIds)).run();
    if (modelIds.length)
      tx.delete(exports).where(inArray(exports.modelId, modelIds)).run();
    tx.delete(models).where(eq(models.projectId, id)).run();
    tx.delete(sessions).where(eq(sessions.projectId, id)).run();
    tx.delete(projects).where(eq(projects.id, id)).run();
  });

  // Remove the project folder — but only if it lives under the workspace root.
  const root = resolve(getWorkspaceRoot());
  if (resolve(row.dir).startsWith(root + "/")) {
    rmSync(row.dir, { recursive: true, force: true });
  }
}
