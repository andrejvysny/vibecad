import { describe, expect, it } from "vitest";
import { deriveLatestPreviews } from "../renderer/src/stores/preview";

describe("deriveLatestPreviews", () => {
  it("maps the latest model's PNGs to absolute paths", () => {
    const files = [
      "model_001.scad",
      "model_001_front.png",
      "model_002.scad",
      "model_002_front.png",
      "model_002_iso.png",
    ];
    expect(deriveLatestPreviews(files, "/proj")).toEqual({
      front: "/proj/model_002_front.png",
      iso: "/proj/model_002_iso.png",
    });
  });

  it("returns empty when no source model exists", () => {
    expect(deriveLatestPreviews(["readme.txt"], "/proj")).toEqual({});
  });

  it("works for .py sources too", () => {
    const files = ["model_003.py", "model_003_top.png"];
    expect(deriveLatestPreviews(files, "/p")).toEqual({
      top: "/p/model_003_top.png",
    });
  });
});
