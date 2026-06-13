import { describe, expect, it } from "vitest";
import { isMeshStale } from "../electron/src/main/preview-util";

describe("isMeshStale", () => {
  it("is stale when the mesh is missing", () => {
    expect(isMeshStale(1000, null)).toBe(true);
  });

  it("is stale when the mesh is older than its source", () => {
    expect(isMeshStale(2000, 1000)).toBe(true);
  });

  it("is fresh when the mesh is newer than its source", () => {
    expect(isMeshStale(1000, 2000)).toBe(false);
  });

  it("treats an equal mtime as fresh (export at/after source)", () => {
    expect(isMeshStale(1500, 1500)).toBe(false);
  });
});
