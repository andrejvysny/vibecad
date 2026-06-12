import { describe, expect, it } from "vitest";
import { openscadBackend } from "../electron/src/main/modeling/openscad";

describe("openscadBackend.extractParams", () => {
  it("extracts top-level numeric assignments with type + line numbers", async () => {
    const src = ["wall_thickness = 2.5;", "height = 30;", "hole = 5;"].join(
      "\n",
    );
    const params = await openscadBackend.extractParams(src);
    expect(params).toEqual([
      { name: "wall_thickness", value: 2.5, type: "number", line: 0 },
      { name: "height", value: 30, type: "integer", line: 1 },
      { name: "hole", value: 5, type: "integer", line: 2 },
    ]);
  });

  it("ignores non-numeric / non-assignment lines", async () => {
    const params = await openscadBackend.extractParams(
      "cube([1,2,3]);\nx = 4;\n",
    );
    expect(params.map((p) => p.name)).toEqual(["x"]);
  });

  it("parses Customizer range comments (min:max and min:step:max)", async () => {
    const params = await openscadBackend.extractParams(
      [
        "width = 50;   // [20:100] Width in mm",
        "wall = 2;     // [1:0.5:5] Wall thickness",
      ].join("\n"),
    );
    expect(params[0]).toEqual({
      name: "width",
      value: 50,
      type: "integer",
      line: 0,
      min: 20,
      max: 100,
      description: "Width in mm",
    });
    expect(params[1]).toEqual({
      name: "wall",
      value: 2,
      type: "integer",
      line: 1,
      min: 1,
      step: 0.5,
      max: 5,
      description: "Wall thickness",
    });
  });

  it("parses options, booleans, and plain descriptions", async () => {
    const params = await openscadBackend.extractParams(
      [
        'style = "round";  // [round, square] Corner style',
        "rounded = true;   // Add rounded corners",
      ].join("\n"),
    );
    expect(params[0]).toMatchObject({
      name: "style",
      value: "round",
      type: "string",
      options: ["round", "square"],
      description: "Corner style",
    });
    expect(params[1]).toMatchObject({
      name: "rounded",
      value: true,
      type: "boolean",
      description: "Add rounded corners",
    });
  });

  it("skips variables declared inside modules/functions", async () => {
    const src = [
      "top = 1;",
      "module foo() {",
      "  inner = 99;",
      "}",
      "bottom = 2;",
    ].join("\n");
    const params = await openscadBackend.extractParams(src);
    expect(params.map((p) => p.name)).toEqual(["top", "bottom"]);
  });
});
