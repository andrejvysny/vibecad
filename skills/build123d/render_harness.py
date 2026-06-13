"""
render_harness.py — build123d render/export/validate CLI

Usage:
  python render_harness.py <model.py> --camera <front|top|iso> --out <png> [--size WxH]
  python render_harness.py <model.py> --export <stl|3mf|step|dxf> --out <path>
  python render_harness.py <model.py> --check
  python render_harness.py <model.py> --diagnostics   # JSON B-rep report to stdout

Contract: the model assigns its final solid to a top-level variable `result`.
"""
import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

# f3d auto-fits the model to the frame; we only set the viewing direction so any
# model scale frames correctly (the old fixed positions clipped large parts).
CAMERA_DIRECTIONS = {
    "front": "-1,0,0",
    "top":   "0,0,-1",
    "iso":   "-1,-1,-1",
}


def load_result(model_path: str):
    path = Path(model_path).resolve()
    spec = importlib.util.spec_from_file_location("_model", path)
    if spec is None or spec.loader is None:
        sys.exit(f"Cannot load {model_path}")
    mod = importlib.util.module_from_spec(spec)
    # Resolve `from helpers import ...` (helpers.py sits beside this harness) and
    # the model's own sibling modules.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.path.insert(0, str(path.parent))
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    if not hasattr(mod, "result"):
        sys.exit(f"Model has no top-level `result` solid: {model_path}")
    return mod.result


def render_png(result, camera: str, out_path: str, size: str) -> None:
    w, h = (int(x) for x in size.split("x"))
    direction = CAMERA_DIRECTIONS.get(camera)
    if direction is None:
        sys.exit(f"Unknown camera preset: {camera}. Use front, top, or iso.")

    # Export to a temp STEP file then render with f3d
    with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        from build123d import export_step  # type: ignore[import]
        export_step(result, tmp_path)
    except Exception as exc:
        sys.exit(f"STEP export failed: {exc}")

    # f3d auto-frames the bounds; we just orient via --camera-direction.
    import subprocess
    result_proc = subprocess.run(
        [
            "f3d",
            tmp_path,
            "--output", out_path,
            "--resolution", f"{w},{h}",
            f"--camera-direction={direction}",
            "--no-background",
            "--quiet",
        ],
        capture_output=True,
    )
    Path(tmp_path).unlink(missing_ok=True)
    if result_proc.returncode != 0:
        sys.stderr.write(result_proc.stderr.decode())
        sys.exit(f"f3d render failed (exit {result_proc.returncode})")


def do_export(result, fmt: str, out_path: str) -> None:
    from build123d import export_stl, export_step  # type: ignore[import]

    fmt = fmt.lower()
    if fmt == "stl":
        export_stl(result, out_path)
    elif fmt == "step":
        export_step(result, out_path)
    elif fmt == "3mf":
        try:
            from build123d import export_3mf  # type: ignore[import]
            export_3mf(result, out_path)
        except ImportError:
            sys.exit("3MF export requires build123d >= 0.7.0")
    elif fmt == "dxf":
        try:
            from build123d import export_dxf  # type: ignore[import]
            export_dxf(result, out_path)
        except ImportError:
            sys.exit("DXF export requires build123d >= 0.7.0")
    else:
        sys.exit(f"Unknown export format: {fmt}")


def diagnostics(result) -> dict:
    """Deterministic B-rep report (OCCT BRepCheck via is_valid). JSON to stdout."""
    bb = result.bounding_box()
    return {
        "valid": bool(result.is_valid()),
        "volume": float(result.volume),
        "bbox": {
            "min": [bb.min.X, bb.min.Y, bb.min.Z],
            "max": [bb.max.X, bb.max.Y, bb.max.Z],
        },
        "solids": len(result.solids()),
        "shells": len(result.shells()),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="build123d render/export harness")
    ap.add_argument("model", help="Path to model .py file")
    ap.add_argument("--camera", choices=["front", "top", "iso"], help="Render a PNG preview")
    ap.add_argument("--export", metavar="FORMAT", help="Export format: stl|3mf|step|dxf")
    ap.add_argument("--out", metavar="PATH", help="Output file path")
    ap.add_argument("--size", default="800x600", help="Image size WxH (default 800x600)")
    ap.add_argument("--check", action="store_true", help="Validate model only (no output)")
    ap.add_argument("--diagnostics", action="store_true", help="Emit a JSON B-rep report")
    args = ap.parse_args()

    result = load_result(args.model)

    if args.check:
        print(f"OK: {args.model} — result solid loaded successfully")
        return

    if args.diagnostics:
        try:
            print(json.dumps(diagnostics(result)))
        except Exception as exc:  # degrade gracefully — caller treats as skipped
            sys.exit(f"diagnostics failed: {exc}")
        return

    if not args.out:
        sys.exit("--out is required")

    if args.camera:
        render_png(result, args.camera, args.out, args.size)
    elif args.export:
        do_export(result, args.export, args.out)
    else:
        sys.exit("Specify --camera, --export, or --check")


if __name__ == "__main__":
    main()
