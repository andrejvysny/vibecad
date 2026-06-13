import { describe, expect, it } from "vitest";
import {
  analyzeStl,
  StlParseError,
} from "../electron/src/main/diagnostics/stl-analyzer";

type V = [number, number, number];

/** Build a binary STL from triangles (normals zeroed — the analyzer ignores them). */
function binaryStl(tris: V[][]): Buffer {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const tri of tris) {
    o += 12; // normal (zeroed)
    for (const v of tri) {
      buf.writeFloatLE(v[0], o);
      buf.writeFloatLE(v[1], o + 4);
      buf.writeFloatLE(v[2], o + 8);
      o += 12;
    }
    o += 2; // attribute byte count
  }
  return buf;
}

// Unit tetrahedron, consistently outward-wound (every edge shared twice, opposed).
const A: V = [0, 0, 0];
const B: V = [1, 0, 0];
const C: V = [0, 1, 0];
const D: V = [0, 0, 1];
const TETRA: V[][] = [
  [B, C, D],
  [A, D, C],
  [A, B, D],
  [A, C, B],
];

/** 12-triangle cube at the given origin (topology only — winding irrelevant). */
function cube(ox: number): V[][] {
  const p = (x: number, y: number, z: number): V => [ox + x, y, z];
  const v0 = p(0, 0, 0);
  const v1 = p(1, 0, 0);
  const v2 = p(1, 1, 0);
  const v3 = p(0, 1, 0);
  const v4 = p(0, 0, 1);
  const v5 = p(1, 0, 1);
  const v6 = p(1, 1, 1);
  const v7 = p(0, 1, 1);
  return [
    [v0, v1, v2],
    [v0, v2, v3],
    [v4, v5, v6],
    [v4, v6, v7],
    [v0, v1, v5],
    [v0, v5, v4],
    [v3, v2, v6],
    [v3, v6, v7],
    [v0, v3, v7],
    [v0, v7, v4],
    [v1, v2, v6],
    [v1, v6, v5],
  ];
}

describe("analyzeStl", () => {
  it("reports an exact closed tetrahedron", () => {
    const d = analyzeStl(binaryStl(TETRA));
    expect(d.triangles).toBe(4);
    expect(d.bbox).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
    expect(d.volumeMm3).toBeCloseTo(1 / 6, 6);
    expect(d.watertight).toBe(true);
    expect(d.nonManifoldEdges).toBe(0);
    expect(d.shells).toBe(1);
    expect(d.valid).toBeNull();
  });

  it("flags an open single triangle as not watertight", () => {
    const d = analyzeStl(binaryStl([[A, B, C]]));
    expect(d.triangles).toBe(1);
    expect(d.watertight).toBe(false);
    expect(d.nonManifoldEdges).toBe(3); // three boundary edges
    expect(d.shells).toBe(1);
  });

  it("counts two disjoint cubes as two shells", () => {
    const d = analyzeStl(binaryStl([...cube(0), ...cube(10)]));
    expect(d.shells).toBe(2);
    expect(d.triangles).toBe(24);
  });

  it("parses ASCII STL", () => {
    const ascii = [
      "solid t",
      "facet normal 0 0 0",
      "outer loop",
      "vertex 0 0 0",
      "vertex 2 0 0",
      "vertex 0 3 0",
      "endloop",
      "endfacet",
      "endsolid t",
    ].join("\n");
    const d = analyzeStl(Buffer.from(ascii, "utf8"));
    expect(d.triangles).toBe(1);
    expect(d.bbox).toEqual({ min: [0, 0, 0], max: [2, 3, 0] });
  });

  it("throws a typed error on garbage", () => {
    expect(() => analyzeStl(Buffer.from("definitely not an stl"))).toThrow(
      StlParseError,
    );
  });

  it("rejects an ASCII STL with a truncated facet (uneven vertex count)", () => {
    const ascii = [
      "solid t",
      "facet normal 0 0 0",
      "outer loop",
      "vertex 0 0 0",
      "vertex 1 0 0",
      "vertex 0 1 0",
      "vertex 0 0 1", // stray 4th vertex → not a multiple of 3
      "endloop",
      "endsolid t",
    ].join("\n");
    expect(() => analyzeStl(Buffer.from(ascii, "utf8"))).toThrow(StlParseError);
  });
});
