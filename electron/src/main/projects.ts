import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { initDb } from "./db/index.js";
import { exports, messages, models, projects, sessions } from "./db/schema.js";
import { detectBackends } from "./modeling/index.js";
import type { AgentId, BackendId } from "../../../shared/types.js";

/** Seed comment for a new project's instructions file (steers every agent turn). */
const INSTRUCTIONS_TEMPLATE = `# Project Instructions

<!-- Guidance for the agent on this project. Applied to every turn across all
     agents. Examples: target printer/material, default wall thickness, units,
     naming conventions, things to always/never do. Delete this comment when you
     add your own. -->
`;

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

  // Scaffold the project's .studio context dirs (user-authored instructions,
  // custom skills, references, workflows). The bundled backend skill is NOT
  // copied — it's injected per-turn from getSkillsDir() via buildAgentContext().
  const studioDir = join(dir, ".studio");
  mkdirSync(join(studioDir, "skills", "custom"), { recursive: true });
  mkdirSync(join(studioDir, "references"), { recursive: true });
  mkdirSync(join(studioDir, "workflows"), { recursive: true });
  writeFileSync(join(studioDir, "instructions.md"), INSTRUCTIONS_TEMPLATE);

  // Multi-part layout: a `parts/` dir marks the project as using the stable
  // `assembly.{ext}` + parts/ contract (vs. legacy single-file `model_NNN`).
  mkdirSync(join(dir, "parts"), { recursive: true });

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

/** Absolute path to a project's `.studio` context dir (created on demand). */
export function getStudioDir(id: string): string {
  const row = getProject(id);
  if (!row) throw new Error(`Project not found: ${id}`);
  const studioDir = join(row.dir, ".studio");
  mkdirSync(studioDir, { recursive: true });
  return studioDir;
}

/** Read a project's custom instructions; "" when the file is absent (older
 *  projects predate the scaffold). Injected per-turn by buildAgentContext(). */
export function readInstructions(id: string): string {
  const row = getProject(id);
  if (!row) throw new Error(`Project not found: ${id}`);
  try {
    return readFileSync(join(row.dir, ".studio", "instructions.md"), "utf-8");
  } catch {
    return "";
  }
}

export function writeInstructions(id: string, content: string): void {
  writeFileSync(join(getStudioDir(id), "instructions.md"), content);
}

// ──── Custom skills + references (files under .studio, injected per-turn) ──────

/** Strip path separators / unsafe chars so a name stays inside its parent dir. */
function safeName(name: string): string {
  return basename(name).replace(/[^\w.\-]/g, "_") || "item";
}

/** Append _2, _3… until the path is free, so imports never clobber. */
function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  const dir = dirname(path);
  const base = basename(path);
  const dot = base.indexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = join(dir, `${stem}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
}

function listDirNames(dir: string, kind: "dir" | "file"): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => (kind === "dir" ? d.isDirectory() : d.isFile()))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** rmSync only if `target` resolves inside `root` (defends against `..`/symlinks). */
function removeWithin(root: string, target: string): void {
  const r = resolve(root);
  if (resolve(target).startsWith(r + sep)) {
    rmSync(target, { recursive: true, force: true });
  }
}

export function listSkills(id: string): string[] {
  return listDirNames(join(getStudioDir(id), "skills", "custom"), "dir");
}

/** Import a custom skill from a directory (containing SKILL.md) or a SKILL.md
 *  file. Returns the stored skill name. */
export function importSkill(id: string, srcPath: string): string {
  const root = join(getStudioDir(id), "skills", "custom");
  mkdirSync(root, { recursive: true });
  const isDir = statSync(srcPath).isDirectory();
  const skillFile = isDir ? join(srcPath, "SKILL.md") : srcPath;
  if (!existsSync(skillFile)) {
    throw new Error("Selection has no SKILL.md");
  }
  const srcDir = isDir ? srcPath : dirname(srcPath);
  const dest = uniquePath(join(root, safeName(basename(srcDir))));
  mkdirSync(dest, { recursive: true });
  if (isDir) cpSync(srcDir, dest, { recursive: true });
  else cpSync(skillFile, join(dest, "SKILL.md"));
  return basename(dest);
}

export function removeSkill(id: string, name: string): void {
  const root = join(getStudioDir(id), "skills", "custom");
  removeWithin(root, join(root, safeName(name)));
}

export function listReferences(id: string): string[] {
  return listDirNames(join(getStudioDir(id), "references"), "file");
}

export function addReference(id: string, srcPath: string): string {
  const root = join(getStudioDir(id), "references");
  mkdirSync(root, { recursive: true });
  const dest = uniquePath(join(root, safeName(basename(srcPath))));
  cpSync(srcPath, dest);
  return basename(dest);
}

export function removeReference(id: string, name: string): void {
  const root = join(getStudioDir(id), "references");
  removeWithin(root, join(root, safeName(name)));
}

/** Delete one multi-part source file (`parts/<name>.{py,scad}`). Guarded to the
 *  project's `parts/` dir so a crafted path can't escape it. Returns the path. */
export function deletePart(id: string, part: string): string {
  const row = getProject(id);
  if (!row) throw new Error(`Project not found: ${id}`);
  const partsRoot = resolve(row.dir, "parts");
  const target = resolve(row.dir, part);
  if (target !== partsRoot && !target.startsWith(partsRoot + sep)) {
    throw new Error(`Not a part file: ${part}`);
  }
  rmSync(target, { force: true });
  return part;
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
