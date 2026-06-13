import { describe, expect, it } from "vitest";
import { classifyDiagnostics } from "../electron/src/main/repair/policy";
import { parseBrepDiagnostics } from "../electron/src/main/diagnostics/brep";
import type { ModelDiagnostics } from "../shared/types";

const base: ModelDiagnostics = {
  source: "stl",
  bbox: { min: [0, 0, 0], max: [10, 10, 10] },
  volumeMm3: 1000,
  triangles: 12,
  shells: 1,
  watertight: true,
  valid: true,
  nonManifoldEdges: 0,
};

describe("classifyDiagnostics severity table", () => {
  it("accepts a healthy solid", () => {
    expect(classifyDiagnostics(base, "print")).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("0 triangles and non-positive volume are hard errors", () => {
    const d = { ...base, triangles: 0, volumeMm3: 0 };
    expect(
      classifyDiagnostics(d, "print").errors.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("non-watertight is HARD for print but ignored for cad", () => {
    const d = { ...base, watertight: false };
    expect(classifyDiagnostics(d, "print").errors).toHaveLength(1);
    expect(classifyDiagnostics(d, "cad").errors).toHaveLength(0);
  });

  it("non-manifold edges: HARD for print, WARN for cad", () => {
    const d = { ...base, nonManifoldEdges: 4, watertight: true };
    expect(classifyDiagnostics(d, "print").errors).toHaveLength(1);
    const cad = classifyDiagnostics(d, "cad");
    expect(cad.errors).toHaveLength(0);
    expect(cad.warnings).toHaveLength(1);
  });

  it("invalid B-rep is a hard error", () => {
    expect(
      classifyDiagnostics({ ...base, valid: false }, "cad").errors,
    ).toEqual(["B-rep check reports the solid is invalid."]);
  });

  it("multiple shells and oversized bbox are warnings only", () => {
    const d = {
      ...base,
      shells: 3,
      bbox: {
        min: [0, 0, 0] as [number, number, number],
        max: [2000, 5, 5] as [number, number, number],
      },
    };
    const r = classifyDiagnostics(d, "print");
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseBrepDiagnostics", () => {
  it("parses a valid harness JSON payload", () => {
    const json = JSON.stringify({
      valid: true,
      volume: 250.5,
      bbox: { min: [0, 0, 0], max: [5, 5, 10] },
      solids: 1,
      shells: 1,
    });
    expect(parseBrepDiagnostics(json)).toEqual({
      source: "brep",
      bbox: { min: [0, 0, 0], max: [5, 5, 10] },
      volumeMm3: 250.5,
      shells: 1,
      watertight: null,
      valid: true,
    });
  });

  it("returns null on malformed or non-JSON output (→ gate skipped)", () => {
    expect(parseBrepDiagnostics("not json")).toBeNull();
    expect(parseBrepDiagnostics('{"valid": "yes"}')).toBeNull();
    expect(parseBrepDiagnostics("")).toBeNull();
  });
});
