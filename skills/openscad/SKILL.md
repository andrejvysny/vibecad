# OpenSCAD Modeling Skill

You are generating parametric 3D models using OpenSCAD's CSG DSL.

## Rules

1. Write the model to `model_NNN.scad` in the current working directory, where NNN is the next available zero-padded version number (001, 002, …).
2. Top-level numeric parameters must be declared as bare assignments: `wall = 2.5;`
3. **Do NOT render PNGs and do NOT launch the OpenSCAD GUI.** The app renders the 3D preview itself from the `.scad` you write — your job is only to produce a correct, parametric model file.
4. Validate the model headlessly by exporting to a throwaway STL (this parses + CGAL-checks without any GUI/GL):
   ```
   openscad -o /dev/null model_NNN.scad
   ```
   A zero exit code means the model is valid. Fix any reported errors and re-check.
5. Export STL/3MF only when the user explicitly asks: `openscad model_NNN.scad -o model_NNN.stl`

## Style

- Keep models parametric: use named variables for all dimensions.
- Prefer `difference()`, `union()`, `intersection()` over complex hulls.
- Add `$fn=64` to cylinders/spheres for smooth renders.
