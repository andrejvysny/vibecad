---
name: openscad
description: Generate parametric OpenSCAD 3D models for the OpenSCAD Studio desktop app. The app renders the live 3D preview, exports, and surfaces parameters — your job is to write a correct, parametric .scad file.
metadata:
  version: 2.0.0
---

# OpenSCAD Modeling Skill

You generate parametric 3D models with OpenSCAD's CSG DSL **inside the OpenSCAD Studio
desktop app**. The app is the user's interface for everything — preview, export, and
parameters. You only produce the model file.

## How this app works (read first)

- The app renders a **live, interactive 3D preview** (orbit / pan / zoom, Front/Top/Iso
  presets, Edges + Grid toggles) directly from the `.scad` you write. It exports the STL
  itself, headlessly, and displays it. The preview is **Z-up** (matches OpenSCAD).
- The app provides **STL / 3MF export buttons**. The user clicks them.
- The app can read your top-level parameters from the `.scad` source.

## Rules

1. **Write the model to `model_NNN.scad`** in the current working directory, where `NNN` is
   the next available zero-padded version (`001`, `002`, …). One model per file.
2. **Do NOT generate preview PNGs. Do NOT run multi-angle renders. Do NOT launch the OpenSCAD
   GUI.** The app is the preview. PNGs you render are ignored by the UI and only clutter the
   project directory. There is no "visual validation by screenshot" step here — the user looks
   at the live 3D preview.
3. **Do NOT export STL/3MF yourself** unless the user explicitly asks — export is a button in
   the app. (If asked: `"$OPENSCAD_BIN" model_NNN.scad -o model_NNN.stl`.)
4. **Validate headlessly** after writing or editing (no GUI/GL):
   ```bash
   "$OPENSCAD_BIN" --export-format=echo -o /dev/null model_NNN.scad
   ```
   `$OPENSCAD_BIN` is injected by the app (falls back to `openscad` if unset). A zero exit code
   means the model parses and evaluates. Fix any reported errors and re-check.
5. After writing, briefly tell the user what you made and which parameters they can tweak. They
   will see it in the 3D preview automatically.

## Parameters (Customizer convention)

Declare every dimension as a **top-level bare assignment** with a Customizer comment so the app
can surface it. Group with section headers.

```openscad
// === Box ===
width = 60;            // [20:200] Width in mm
wall = 2;              // [1:0.5:5] Wall thickness in mm
corner = 3;            // [0:10] Corner radius
style = "round";       // [round, square] Corner style
include_lid = true;    // Add a separate lid
$fn = 64;              // Smoothness
```

Comment grammar:

- `// [min:max]` — numeric range
- `// [min:step:max]` — numeric range with step
- `// [opt1, opt2, opt3]` — discrete options
- `// Description` — plain description (any of the above may be followed by description text)

Keep models fully parametric: named variables for all dimensions, no magic numbers in geometry.

## Examples

Read these bundled references for good parametric structure (modules, rounded hulls, 2D
profiles, conditional features):

- `examples/parametric_box.scad` — rounded storage box with optional lid
- `examples/phone_stand.scad` — angled stand from a 2D `polygon` profile

## Style

- Prefer `difference()` / `union()` / `intersection()` over deep `hull()` chains.
- Add `$fn = 64;` for smooth cylinders/spheres (lower it only for performance on heavy models).
- Use `module`s for repeated geometry; keep the top level a readable assembly.

## OpenSCAD quick reference

### Primitives

```openscad
cube([x, y, z]);
sphere(r = radius);
cylinder(h = height, r = radius);
cylinder(h = height, r1 = bottom, r2 = top);   // cone
```

### Transformations

```openscad
translate([x, y, z]) obj();
rotate([rx, ry, rz]) obj();
scale([sx, sy, sz]) obj();
mirror([x, y, z]) obj();
```

### Booleans

```openscad
union() { a(); b(); }         // combine
difference() { a(); b(); }    // subtract b from a
intersection() { a(); b(); }  // overlap only
```

### Advanced

```openscad
linear_extrude(height) shape2d();
rotate_extrude() shape2d();
hull() { a(); b(); }          // convex hull
minkowski() { a(); b(); }     // rounding via sum
```

### 2D

```openscad
circle(r = radius);
square([x, y]);
polygon(points = [[x1,y1], [x2,y2], ...]);
text("string", size = 10);
```

## Export / sharing note

Exporting (STL/3MF) is done through the app's export buttons. For 3D-print platforms like
MakerWorld, the user exports the STL from the app and pairs it with a description of the
customizable parameters you declared above — no bash export workflow needed.
