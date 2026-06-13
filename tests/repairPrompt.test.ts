import { describe, expect, it } from "vitest";
import { buildRepairPrompt } from "../electron/src/main/repair/prompts";

const base = {
  modelPath: "/proj/abc/model_003.scad",
  gate: "validate" as const,
  attempt: 1,
  maxAttempts: 2,
  errors: ["ERROR: Parser error in line 12"],
  warnings: [] as string[],
};

describe("buildRepairPrompt", () => {
  it("includes the path, failed gate, and error lines", () => {
    const p = buildRepairPrompt(base);
    expect(p).toContain("/proj/abc/model_003.scad");
    expect(p).toContain("Failed check: validate");
    expect(p).toContain("- ERROR: Parser error in line 12");
  });

  it("uses the attempt counter", () => {
    expect(
      buildRepairPrompt({ ...base, attempt: 2, maxAttempts: 2 }),
    ).toContain("repair attempt 2/2");
  });

  it("tells the agent to fix the basename in place", () => {
    const p = buildRepairPrompt(base);
    expect(p).toContain("Fix model_003.scad IN PLACE");
    expect(p).not.toContain("model_004");
  });

  it("omits the warnings section when there are none", () => {
    expect(buildRepairPrompt(base)).not.toContain("Warnings");
  });

  it("includes a warnings section when present", () => {
    const p = buildRepairPrompt({ ...base, warnings: ["bbox > 1000mm"] });
    expect(p).toContain("Warnings (context only");
    expect(p).toContain("- bbox > 1000mm");
  });

  it("truncates a runaway error dump", () => {
    const huge = "x".repeat(50_000);
    const p = buildRepairPrompt({ ...base, errors: [huge] });
    expect(p).toContain("… (truncated)");
    // Bounded well under the raw 50 KB input.
    expect(p.length).toBeLessThan(3_000);
  });
});
