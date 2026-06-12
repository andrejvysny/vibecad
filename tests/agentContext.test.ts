import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgentContext } from "../electron/src/main/agent-context";

let dir: string;
let bundledSkillDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vibecad-ctx-"));
  bundledSkillDir = await mkdtemp(join(tmpdir(), "vibecad-skill-"));
  await writeFile(
    join(bundledSkillDir, "SKILL.md"),
    "name: openscad\nWrite model_NNN.scad",
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(bundledSkillDir, { recursive: true, force: true });
});

const project = () => ({ dir, modelingBackend: "openscad" });

describe("buildAgentContext", () => {
  it("always inlines the bundled skill and exposes its dir", async () => {
    const ctx = await buildAgentContext(project(), { bundledSkillDir });
    expect(ctx.contextDirs).toContain(bundledSkillDir);
    expect(ctx.preamble).toContain("model_NNN.scad");
    expect(ctx.preamble).toContain("## Skill: openscad");
  });

  it("includes project instructions, custom skills, references, attachments", async () => {
    const studio = join(dir, ".studio");
    await mkdir(join(studio, "skills", "custom", "fillets"), {
      recursive: true,
    });
    await mkdir(join(studio, "references"), { recursive: true });
    await writeFile(join(studio, "instructions.md"), "Use 3mm walls.");
    await writeFile(
      join(studio, "skills", "custom", "fillets", "SKILL.md"),
      "Always round outer edges.",
    );
    await writeFile(join(studio, "references", "spec.txt"), "ref body");

    const ctx = await buildAgentContext(project(), {
      bundledSkillDir,
      attachments: ["/abs/img.png"],
    });

    expect(ctx.preamble).toContain("## Project Instructions");
    expect(ctx.preamble).toContain("Use 3mm walls.");
    expect(ctx.preamble).toContain("## Skill: fillets (custom)");
    expect(ctx.preamble).toContain("Always round outer edges.");
    expect(ctx.preamble).toContain("## Reference files");
    expect(ctx.preamble).toContain(join(studio, "references", "spec.txt"));
    expect(ctx.preamble).toContain("/abs/img.png");
  });

  it("omits empty instructions and absent dirs", async () => {
    const studio = join(dir, ".studio");
    await mkdir(studio, { recursive: true });
    await writeFile(join(studio, "instructions.md"), "   \n");

    const ctx = await buildAgentContext(project(), { bundledSkillDir });
    expect(ctx.preamble).not.toContain("## Project Instructions");
    expect(ctx.preamble).not.toContain("## Reference files");
  });
});
