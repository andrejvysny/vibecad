import { describe, expect, it } from "vitest";
import { parseOpenscadStderr } from "../electron/src/main/diagnostics/openscad-stderr";

describe("parseOpenscadStderr", () => {
  it("classifies ERROR: lines as errors", () => {
    const r = parseOpenscadStderr("ERROR: Parser error in line 3\n");
    expect(r.errors).toEqual(["ERROR: Parser error in line 3"]);
    expect(r.warnings).toEqual([]);
  });

  it("treats 'No top level geometry' as an error even under WARNING:", () => {
    const r = parseOpenscadStderr("WARNING: No top level geometry to render!");
    expect(r.errors).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  it("treats 'not a 3D object' as an error", () => {
    const r = parseOpenscadStderr(
      "Current top level object is not a 3D object.",
    );
    expect(r.errors).toHaveLength(1);
  });

  it("classifies CGAL / 2-manifold advisories as warnings", () => {
    const r = parseOpenscadStderr(
      "WARNING: Object may not be a valid 2-manifold and may need repair!",
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it("returns empty for clean output", () => {
    const r = parseOpenscadStderr(
      "Geometries in cache: 3\nTotal rendering time: 0:00:01\n",
    );
    expect(r).toEqual({ errors: [], warnings: [] });
  });
});
