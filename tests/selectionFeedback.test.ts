import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAgentContext,
  formatSelectionFeedback,
} from "../electron/src/main/agent-context";

describe("formatSelectionFeedback", () => {
  it("renders numbered points with and without notes", () => {
    const block = formatSelectionFeedback({
      points: [
        { n: 1, x: 12, y: 0, z: 30, note: "hole too small" },
        { n: 2, x: 0, y: 40, z: 5, note: "  " },
      ],
    });
    expect(block).toContain("## Manual feedback — user-selected regions");
    expect(block).toContain("1. (12, 0, 30) — hole too small");
    // Blank note → no trailing dash.
    expect(block).toContain("2. (0, 40, 5)");
    expect(block).not.toContain("2. (0, 40, 5) —");
  });

  it("renders a region bounding box", () => {
    const block = formatSelectionFeedback({
      points: [],
      region: { min: [1, 2, 3], max: [4, 5, 6] },
    });
    expect(block).toContain("min (1, 2, 3) → max (4, 5, 6)");
  });

  it("returns null when there is nothing to say", () => {
    expect(formatSelectionFeedback({ points: [] })).toBeNull();
  });
});

describe("buildAgentContext selection section", () => {
  let dir: string;
  let bundledSkillDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vibecad-sel-"));
    bundledSkillDir = await mkdtemp(join(tmpdir(), "vibecad-skill-"));
    await writeFile(join(bundledSkillDir, "SKILL.md"), "name: openscad");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(bundledSkillDir, { recursive: true, force: true });
  });

  it("injects the manual-feedback section when selection is present", async () => {
    const ctx = await buildAgentContext(
      { dir, modelingBackend: "openscad" },
      {
        bundledSkillDir,
        selection: { points: [{ n: 1, x: 1, y: 2, z: 3, note: "fix" }] },
      },
    );
    expect(ctx.preamble).toContain(
      "## Manual feedback — user-selected regions",
    );
    expect(ctx.preamble).toContain("1. (1, 2, 3) — fix");
  });

  it("omits the section when no selection is given", async () => {
    const ctx = await buildAgentContext(
      { dir, modelingBackend: "openscad" },
      { bundledSkillDir },
    );
    expect(ctx.preamble).not.toContain("## Manual feedback");
  });
});
