# build123d Modeling Skill

You are generating parametric 3D models using build123d (Python, OpenCascade B-rep).

## Rules

1. Write the model to `model_NNN.py` in the current working directory.
2. The final solid **must** be assigned to a top-level variable named `result`:
   ```python
   result = my_part  # render harness requires this
   ```
3. Top-level numeric parameters must be bare module-level assignments: `wall = 2.5`
4. **Do NOT render PNGs.** The app renders the 3D preview itself from the `.py` you write — your job is only to produce a correct model whose final solid is `result`.
5. Validate headlessly: `python render_harness.py model_NNN.py --check` (a zero exit code means `result` builds). Fix any reported errors and re-check.
6. Export only when the user explicitly asks:
   ```
   python render_harness.py model_NNN.py --export step --out model_NNN.step
   python render_harness.py model_NNN.py --export stl  --out model_NNN.stl
   ```

## Style

- Use `with BuildPart() as part:` context manager pattern.
- Keep all dimensions as named variables at the top of the file.
- For holes: `with Locations(...): Hole(radius=r)` inside the BuildPart context.
- Fillets: `part.part = fillet(part.part.edges(), radius=r)` after the main body.
