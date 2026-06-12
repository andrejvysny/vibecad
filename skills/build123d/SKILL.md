# build123d Modeling Skill

You are generating parametric 3D models using build123d (Python, OpenCascade B-rep).

## Rules

1. Write the model to `model_NNN.py` in the current working directory.
2. The final solid **must** be assigned to a top-level variable named `result`:
   ```python
   result = my_part  # render harness requires this
   ```
3. Top-level numeric parameters must be bare module-level assignments: `wall = 2.5`
4. After writing the file, render three PNG previews using the render harness:
   ```
   python render_harness.py model_NNN.py --camera front --out model_NNN_front.png --size 800x600
   python render_harness.py model_NNN.py --camera top   --out model_NNN_top.png   --size 800x600
   python render_harness.py model_NNN.py --camera iso   --out model_NNN_iso.png   --size 800x600
   ```
5. Validate: `python render_harness.py model_NNN.py --check`
6. Export only when requested:
   ```
   python render_harness.py model_NNN.py --export step --out model_NNN.step
   python render_harness.py model_NNN.py --export stl  --out model_NNN.stl
   ```

## Style

- Use `with BuildPart() as part:` context manager pattern.
- Keep all dimensions as named variables at the top of the file.
- For holes: `with Locations(...): Hole(radius=r)` inside the BuildPart context.
- Fillets: `part.part = fillet(part.part.edges(), radius=r)` after the main body.
