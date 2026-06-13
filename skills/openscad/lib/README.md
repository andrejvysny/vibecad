# OpenSCAD libraries (OPENSCADPATH)

The app prepends this directory to `OPENSCADPATH` for both its own headless exports
and the agent's spawns (see `configureOpenscadPath()` in `electron/src/main/index.ts`),
so any library vendored here is resolvable via `include <Lib/...>` with no setup.

## BOSL2 (pending vendor)

`skills/openscad/SKILL.md` instructs the agent to prefer **BOSL2**. Vendor it here once
(pin a commit known-good on OpenSCAD 2021.01):

```bash
git clone --depth 1 https://github.com/BelfrySCAD/BOSL2.git skills/openscad/lib/BOSL2
rm -rf skills/openscad/lib/BOSL2/.git   # vendored snapshot (not a submodule)
```

`electron-builder.cjs` already ships `skills/` as `extraResources`, so a vendored
`BOSL2/` is bundled into packaged builds automatically. Until it's vendored, the skill's
headless `--export-format=echo` validate catches a missing `include <BOSL2/std.scad>` and
the agent falls back to OpenSCAD's built-in primitives.
