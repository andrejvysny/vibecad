import { describe, expect, it } from "vitest";
import {
  buildGroups,
  groupKey,
  previewLabel,
} from "../renderer/src/components/WorkspaceTree/groups";

describe("groupKey", () => {
  it("keys part sources/exports/previews under one parts/<name> key", () => {
    expect(groupKey("parts/lid.py")).toBe("parts/lid");
    expect(groupKey("parts/lid.step")).toBe("parts/lid");
    expect(groupKey("parts/lid_iso.png")).toBe("parts/lid");
  });

  it("keys the assembly entry and its artifacts as assembly", () => {
    expect(groupKey("assembly.py")).toBe("assembly");
    expect(groupKey("assembly_front.png")).toBe("assembly");
  });

  it("preserves legacy model_NNN keys", () => {
    expect(groupKey("model_003.scad")).toBe("model_003");
    expect(groupKey("model_003_top.png")).toBe("model_003");
  });
});

describe("buildGroups", () => {
  it("buckets assembly, parts, and legacy artifacts by kind", () => {
    const groups = buildGroups([
      "assembly.py",
      "assembly.step",
      "assembly_iso.png",
      "parts", // the dir entry — ignored
      "parts/base.py",
      "parts/lid.py",
      "parts/lid.step",
      ".studio", // ignored
      "model_001.scad",
    ]);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));

    expect(byKey["assembly"]?.kind).toBe("assembly");
    expect(byKey["assembly"]?.source).toBe("assembly.py");
    expect(byKey["assembly"]?.exports).toContain("assembly.step");

    expect(byKey["parts/base"]?.kind).toBe("part");
    expect(byKey["parts/lid"]?.kind).toBe("part");
    expect(byKey["parts/lid"]?.exports).toContain("parts/lid.step");

    expect(byKey["model_001"]?.kind).toBe("legacy");
    // Bare dir/dotfile entries never become groups.
    expect(byKey["parts"]).toBeUndefined();
    expect(byKey[""]).toBeUndefined();
  });
});

describe("previewLabel", () => {
  it("extracts the render angle for a part preview", () => {
    expect(previewLabel("parts/lid_iso.png", "parts/lid")).toBe("iso");
  });
  it("falls back to the bare filename otherwise", () => {
    expect(previewLabel("parts/lid/extra.png", "parts/lid")).toBe("extra.png");
  });
});
