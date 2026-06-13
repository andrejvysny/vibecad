---
name: build123d
description: Generate parametric 3D CAD models using build123d (Python, OpenCascade B-rep) for the VibeCAD desktop app. The app renders the preview, snapshots, exports, and surfaces parameters — you write a correct .py whose final solid is `result`.
metadata:
  version: 2.0.0
---

# build123d Modeling Skill

You generate parametric 3D models using **build123d** (Python, OpenCascade B-rep)
**inside the VibeCAD desktop app**. The app is the user's interface — preview,
export, snapshots, parameters. You only produce the model file.

## How this app works (read first)

- The app renders the **live 3D preview** itself from the precise STEP it exports from your
  `.py`. It also writes an STL. You never export or render for the preview.
- The app runs **automated geometry checks** after every turn (build, export, OCCT
  `is_valid()`, volume, watertightness). A failed check comes back as an automated repair
  message — see the rules.
- The app **renders snapshot PNGs itself** and hands you their paths when a visual check is
  requested. Never render your own.

## Rules

1. **Write the model to `model_NNN.py`** in the current working directory (`NNN` = next
   zero-padded version). One model per file.
2. The final solid **must** be assigned to a top-level variable named `result`:
   ```python
   result = part.part   # the app's harness requires this
   ```
3. **Do NOT render PNGs.** The app renders the preview and the snapshot PNGs itself and gives
   you their paths when visual verification is requested — **Read those**.
4. **On an automated repair message, fix the named file IN PLACE.** Never create a new
   `model_NNN` for a repair — the app previews the highest version, so a new file orphans the
   broken one. Re-run `--check` before finishing.
5. **Validate headlessly** after writing or editing:
   ```bash
   python render_harness.py model_NNN.py --check
   ```
   A zero exit code means `result` builds. Fix any reported errors and re-check.
6. **Export only when the user explicitly asks** (it's a button in the app):
   ```bash
   python render_harness.py model_NNN.py --export step --out model_NNN.step
   python render_harness.py model_NNN.py --export stl  --out model_NNN.stl
   ```

## House style

- **Annotate every dimension** as a top-level assignment with a `# PARAM` comment so the app
  can surface it as an editable control:
  ```python
  width  = 60.0     # PARAM [20:200] Width in mm
  height = 30.0     # PARAM [10:120] Height in mm
  style  = "round"  # PARAM [round, square] Corner style
  rounded = True    # PARAM Add filleted corners
  # === Holes ===
  hole_d = 4.0      # PARAM [2:10] Mounting hole Ø in mm
  ```
  Grammar: `# PARAM [min:max] desc`, `# PARAM [min:step:max] desc`,
  `# PARAM [opt1, opt2] desc`, `# PARAM desc`. A `# === Section ===` line groups the params
  below it. A trailing `… in mm` becomes the unit shown in the UI.
- **All dimensions parametric** — named, annotated module-level variables; no magic numbers in
  the geometry.
- **No raw `OCP.*` imports.** Stay in the build123d API. `from helpers import …` is allowed
  (see below).
- End the model by assigning `result` (and optionally `assert_solid(result)` to fail fast).

## Bundled helpers

`from helpers import rounded_box, counterbored_hole, assert_solid` resolves automatically
(the harness puts the skill dir on `sys.path`):

```python
from helpers import rounded_box, counterbored_hole, assert_solid
from build123d import Pos

result = rounded_box(60, 40, 20, radius=3)
result = result - counterbored_hole(3, 6, 3, 20).moved(Pos(20, 0, 10))
assert_solid(result)
```

## Modeling patterns

- Builder API: `with BuildPart() as part: Box(...); ...` then `result = part.part`.
- Holes: `with Locations((x, y)): Hole(radius=r)` inside the `BuildPart` context.
- Fillets/chamfers: `fillet(part.edges().filter_by(Axis.Z), radius=r)`.
- Prefer the bundled `helpers` over re-deriving rounding/counterbores by hand.
