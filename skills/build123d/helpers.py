"""helpers.py — small vetted build123d helpers.

The render harness puts this directory on sys.path, so model files can
`from helpers import rounded_box, counterbored_hole, assert_solid` and the
import resolves for both `--check` and exports.
"""
from build123d import Align, Box, BuildPart, Cylinder, fillet


def rounded_box(length: float, width: float, height: float, radius: float):
    """Axis-aligned box with every edge filleted to `radius`.

    `radius` must be smaller than half the smallest dimension or the fillet fails.
    """
    with BuildPart() as bp:
        Box(length, width, height)
        fillet(bp.edges(), radius=radius)
    return bp.part


def counterbored_hole(
    hole_d: float, cbore_d: float, cbore_depth: float, through: float
):
    """A counterbore cutter solid: a `through`-deep `hole_d` shaft with a
    `cbore_depth`-deep `cbore_d` recess, both with their TOP face at z=0 and
    extending downward. Subtract it from your part at a location:

        result = part - counterbored_hole(3, 6, 3, 20).moved(Pos(x, y, 0))
    """
    top = (Align.CENTER, Align.CENTER, Align.MAX)
    shaft = Cylinder(hole_d / 2, through, align=top)
    recess = Cylinder(cbore_d / 2, cbore_depth, align=top)
    return shaft + recess


def assert_solid(result) -> None:
    """Fail fast unless `result` is at least one valid solid — call at the end of
    a model so a broken build is caught before the app exports it."""
    solids = result.solids()
    assert len(solids) >= 1, "result contains no solids"
    assert result.is_valid(), "result failed the OCCT validity check"
