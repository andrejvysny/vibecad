import { describe, expect, it } from "vitest";
import { latestModelBase } from "../renderer/src/stores/preview";

describe("latestModelBase", () => {
  it("returns the highest-versioned source basename", () => {
    expect(
      latestModelBase([
        "model_001.scad",
        "model_001_front.png",
        "model_002.scad",
        "model_002_iso.png",
      ]),
    ).toBe("model_002");
  });

  it("returns null when no source model exists", () => {
    expect(latestModelBase(["readme.txt", "model_004_iso.png"])).toBeNull();
  });

  it("works for .py sources too", () => {
    expect(latestModelBase(["model_003.py", "model_003_top.png"])).toBe(
      "model_003",
    );
  });

  it("compares numeric suffixes, not lexicographic filenames", () => {
    expect(latestModelBase(["model_9.scad", "model_10.scad"])).toBe("model_10");
  });

  it("prefers the stable assembly entry for multi-part projects", () => {
    expect(
      latestModelBase(["assembly.py", "parts/base.py", "parts/lid.py"]),
    ).toBe("assembly");
  });

  it("prefers assembly even when legacy model_NNN files coexist", () => {
    expect(latestModelBase(["model_005.scad", "assembly.scad"])).toBe(
      "assembly",
    );
  });
});
