# OpenSCAD Modeling Skill

You are generating parametric 3D models using OpenSCAD's CSG DSL.

## Rules

1. Write the model to `model_NNN.scad` in the current working directory, where NNN is the next available zero-padded version number (001, 002, …).
2. Top-level numeric parameters must be declared as bare assignments: `wall = 2.5;`
3. After writing the file, render three PNG previews using the OpenSCAD CLI:
   ```
   openscad --render model_NNN.scad -o model_NNN_front.png --camera=0,0,0,0,0,0,200 --imgsize=800,600
   openscad --render model_NNN.scad -o model_NNN_top.png   --camera=0,0,0,90,0,0,200 --imgsize=800,600
   openscad --render model_NNN.scad -o model_NNN_iso.png   --camera=0,0,0,45,0,45,200 --imgsize=800,600
   ```
4. Validate with `openscad --check-parameters model_NNN.scad`.
5. Export STL/3MF only when explicitly requested: `openscad model_NNN.scad -o model_NNN.stl`

## Style

- Keep models parametric: use named variables for all dimensions.
- Prefer `difference()`, `union()`, `intersection()` over complex hulls.
- Add `$fn=64` to cylinders/spheres for smooth renders.
