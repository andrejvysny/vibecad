import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

  return { preamble: sections.join("\n\n---\n\n"), contextDirs };
}
