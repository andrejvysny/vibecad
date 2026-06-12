import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { initDb } from "./db/index.js";
import { projects } from "./db/schema.js";
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
