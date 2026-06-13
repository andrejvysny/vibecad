import { describe, expect, it } from "vitest";
import { buildEditScopePrompt } from "../electron/src/main/repair/prompts";

describe("buildEditScopePrompt", () => {
  it("lists each scoped part as a bullet", () => {
    const p = buildEditScopePrompt(["parts/base.py", "parts/lid.py"]);
    expect(p).toContain("- parts/base.py");
    expect(p).toContain("- parts/lid.py");
  });

  it("instructs the agent to leave other parts and the assembly untouched", () => {
    const p = buildEditScopePrompt(["parts/lid.py"]);
    expect(p).toMatch(/ONLY these part files/);
    expect(p).toContain("assembly");
  });
});
