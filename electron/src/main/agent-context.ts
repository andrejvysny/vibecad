import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SelectionFeedback } from "../../../shared/ipc.js";

export interface AgentContext {
  /** Assembled markdown injected per-agent (system prompt or prompt prefix). */
  preamble: string;
  /** Dirs to grant the agent read access to (only the bundled skill, which
   *  lives outside the project cwd; .studio/* is already under cwd). */
  contextDirs: string[];
}

interface BuildOpts {
  /** Absolute path to the bundled backend skill dir (resolved by the caller so
   *  this module stays free of Electron imports and remains unit-testable). */
  bundledSkillDir: string;
  /** Absolute image paths the user attached to this turn. */
  attachments?: string[];
  /** Pins/region the user marked on the 3D model this turn (model-space mm). */
  selection?: SelectionFeedback;
}

/**
 * Render a user's 3D markup as a markdown block the agent can act on. Pure (no
 * I/O) so it's unit-testable. Returns null when there's nothing to say. Pins are
 * numbered to match the badges baked into the attached annotated screenshot.
 */
export function formatSelectionFeedback(
  selection: SelectionFeedback,
): string | null {
  const lines: string[] = [];
  for (const p of selection.points) {
    const coord = `(${p.x}, ${p.y}, ${p.z})`;
    lines.push(
      `- ${p.n}. ${coord}${p.note.trim() ? ` — ${p.note.trim()}` : ""}`,
    );
  }
  const parts: string[] = [];
  if (lines.length) {
    parts.push(`Marked points (model coordinates, mm):\n${lines.join("\n")}`);
  }
  if (selection.region) {
    const { min, max } = selection.region;
    parts.push(
      `Region of interest (bounding box, mm): min (${min.join(", ")}) → max (${max.join(", ")}).`,
    );
  }
  if (!parts.length) return null;
  parts.push(
    "The user marked these on the 3D view to point you at what to change. " +
      "An annotated screenshot is attached above (numbered pins match the points). " +
      "Focus your edits on these locations.",
  );
  return `## Manual feedback — user-selected regions\n\n${parts.join("\n\n")}`;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, "utf-8");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch {
    return [];
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Assemble the per-project agent context (spec §11 plus user-authored
 * instructions/skills/references). Every source is a file under
 * `<project>/.studio/` or the bundled backend skill. Skill text is inlined into
 * the preamble for ALL agents (so dir-blind CLIs get the rules too); the bundled
 * skill dir is also returned in `contextDirs` so file-capable agents can read its
 * example files. References live under cwd, so every agent can Read them by path.
 */
export async function buildAgentContext(
  project: { dir: string; modelingBackend: string },
  opts: BuildOpts,
): Promise<AgentContext> {
  const studioDir = join(project.dir, ".studio");
  const sections: string[] = [];
  const contextDirs: string[] = [];

  // 1. Custom project instructions.
  const instructions = await readIfPresent(join(studioDir, "instructions.md"));
  if (instructions) {
    sections.push(`## Project Instructions\n\n${instructions.trim()}`);
  }

  // 2. Bundled backend skill — inlined for every agent; dir exposed so
  //    file-capable agents can also read its example files.
  contextDirs.push(opts.bundledSkillDir);
  const bundledSkill = await readIfPresent(
    join(opts.bundledSkillDir, "SKILL.md"),
  );
  if (bundledSkill) {
    sections.push(
      `## Skill: ${project.modelingBackend}\n\n${bundledSkill.trim()}`,
    );
  }

  // 2b. Project layout mode — disambiguates the skill's file contract. New
  //     projects scaffold a `parts/` dir (multi-part); older ones predate it and
  //     must keep their single-file `model_NNN` flow.
  const multiPart = await dirExists(join(project.dir, "parts"));
  sections.push(
    multiPart
      ? "## Project layout: multi-part\n\nThis project uses the stable `assembly" +
          (project.modelingBackend === "openscad" ? ".scad" : ".py") +
          "` entry + `parts/` layout described in the skill. Edit files in place; do not create `model_NNN` files."
      : "## Project layout: legacy single-file\n\nThis is a legacy project — keep using the single-file `model_NNN` convention; ignore the skill's assembly/parts section. Do not create a `parts/` dir or an `assembly` file.",
  );

  // 3. Custom/external skills layered on top.
  const customSkillsRoot = join(studioDir, "skills", "custom");
  for (const name of await listDir(customSkillsRoot)) {
    const text = await readIfPresent(join(customSkillsRoot, name, "SKILL.md"));
    if (text) sections.push(`## Skill: ${name} (custom)\n\n${text.trim()}`);
  }

  // 4. Reference files — listed as paths; every agent can Read them (under cwd).
  const referencesDir = join(studioDir, "references");
  const refs = await listDir(referencesDir);
  if (refs.length) {
    const list = refs.map((f) => `- ${join(referencesDir, f)}`).join("\n");
    sections.push(`## Reference files (read as needed)\n\n${list}`);
  }

  // 5. Image attachments (folded in from the old withAttachments()).
  if (opts.attachments?.length) {
    const list = opts.attachments.map((p) => `- ${p}`).join("\n");
    sections.push(`## Attached image(s) for reference (read them)\n\n${list}`);
  }

  // 6. Manual 3D feedback — pins/region the user marked this turn.
  if (opts.selection) {
    const block = formatSelectionFeedback(opts.selection);
    if (block) sections.push(block);
  }

  return { preamble: sections.join("\n\n---\n\n"), contextDirs };
}
