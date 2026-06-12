import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { getStudioDir } from "./projects.js";
import type { Workflow } from "../../../shared/types.js";

/** `<project>/.studio/workflows`, created on demand. */
function workflowsDir(projectId: string): string {
  const dir = join(getStudioDir(projectId), "workflows");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workflow"
  );
}

/** Constrain a slug to a single safe filename stem (no separators / traversal). */
function safeSlug(slug: string): string {
  return basename(slug).replace(/[^a-z0-9\-]/gi, "-") || "workflow";
}

export function listWorkflows(projectId: string): Workflow[] {
  const dir = workflowsDir(projectId);
  const out: Workflow[] = [];
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    try {
      const wf = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Workflow;
      out.push({ ...wf, slug: basename(f, ".json") });
    } catch {
      /* skip malformed recipe files */
    }
  }
  return out;
}

export function getWorkflow(projectId: string, slug: string): Workflow {
  const file = join(workflowsDir(projectId), `${safeSlug(slug)}.json`);
  const wf = JSON.parse(readFileSync(file, "utf-8")) as Workflow;
  return { ...wf, slug: safeSlug(slug) };
}

export function saveWorkflow(projectId: string, wf: Workflow): Workflow {
  if (!wf.name?.trim()) throw new Error("Workflow needs a name");
  if (!wf.steps?.length) throw new Error("Workflow needs at least one step");
  const dir = workflowsDir(projectId);
  const slug = wf.slug ? safeSlug(wf.slug) : slugify(wf.name);
  const stored: Workflow = {
    slug,
    name: wf.name.trim(),
    description: wf.description?.trim() || undefined,
    kind: wf.kind ?? "recipe",
    steps: wf.steps.map((s) => ({
      title: s.title.trim() || "Step",
      prompt: s.prompt,
      ...(s.autoAdvance === false ? { autoAdvance: false } : {}),
    })),
  };
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify(stored, null, 2));
  return stored;
}

export function deleteWorkflow(projectId: string, slug: string): void {
  const dir = workflowsDir(projectId);
  const file = join(dir, `${safeSlug(slug)}.json`);
  if (resolve(file).startsWith(resolve(dir) + sep)) {
    rmSync(file, { force: true });
  }
}
