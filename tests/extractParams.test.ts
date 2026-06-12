import { describe, expect, it } from "vitest";
import { openscadBackend } from "../electron/src/main/modeling/openscad";

describe("openscadBackend.extractParams", () => {
  it("extracts top-level numeric assignments with line numbers", async () => {
    const src = ["wall_thickness = 2.5;", "height = 30;", "hole = 5;"].join(
      "\n",
    );
    const params = await openscadBackend.extractParams(src);
    expect(params).toEqual([
      { name: "wall_thickness", value: 2.5, line: 0 },
      { name: "height", value: 30, line: 1 },
      { name: "hole", value: 5, line: 2 },
    ]);
  });

  it("ignores non-numeric / non-assignment lines", async () => {
    const params = await openscadBackend.extractParams(
      "cube([1,2,3]);\nx = 4;\n",
    );
    expect(params.map((p) => p.name)).toEqual(["x"]);
  });
});
