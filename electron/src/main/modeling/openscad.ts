import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { cleanSpawnEnv } from "../spawn-env.js";
import { resolveOpenscad } from "./resolve-openscad.js";
import type {
  BackendStatus,
  CameraPreset,
  ExportFormat,
  ModelingBackend,
  Param,
  RenderRequest,
  ValidationResult,
} from "../../../../shared/types.js";

// openscad --camera=translateX,Y,Z,rotX,Y,Z,dist
const CAMERA_ARGS: Record<CameraPreset, string> = {
  front: "0,0,0,0,0,0,200",
  top: "0,0,0,90,0,0,200",
  iso: "0,0,0,45,0,45,200",
};

function spawnAsync(
  cmd: string,
  args: string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: cleanSpawnEnv(),
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/** Run a backend CLI and throw with stderr if it exits non-zero. */
async function run(cmd: string, args: string[]): Promise<void> {
  const { code, stderr } = await spawnAsync(cmd, args);
  if (code !== 0) {
    throw new Error(stderr.trim() || `${cmd} exited with code ${code}`);
  }
}

/** Resolved OpenSCAD binary, or throw a clear error. */
async function bin(): Promise<string> {
  const path = await resolveOpenscad();
  if (!path) throw new Error("OpenSCAD not found");
  return path;
}

function count(s: string, c: string): number {
  return s.split(c).length - 1;
}

/** Classify a raw RHS value into a parameter type + parsed value. */
function classify(raw: string): { type: Param["type"]; value: Param["value"] } {
  if (raw === "true" || raw === "false") {
    return { type: "boolean", value: raw === "true" };
  }
  if (/^-?\d+$/.test(raw)) return { type: "integer", value: parseInt(raw, 10) };
  if (/^-?\d*\.?\d+$/.test(raw)) {
    return { type: "number", value: parseFloat(raw) };
  }
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return { type: "string", value: raw.slice(1, -1) };
  }
  if (raw.startsWith("[")) return { type: "array", value: raw };
  return { type: "expression", value: raw };
}

/** Parse a Customizer comment (`[min:max] desc`, `[a,b] desc`, or `desc`). */
function parseComment(comment: string, p: Param): void {
  if (!comment) return;
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(comment);
  if (!m) {
    p.description = comment;
    return;
  }
  const bracket = (m[1] ?? "").trim();
  const desc = (m[2] ?? "").trim();
  if (desc) p.description = desc;

  if (bracket.includes(":") && !bracket.includes(",")) {
    const parts = bracket.split(":").map((s) => parseFloat(s.trim()));
    if (parts.length === 2) {
      [p.min, p.max] = parts as [number, number];
    } else if (parts.length === 3) {
      [p.min, p.step, p.max] = parts as [number, number, number];
    }
  } else {
    p.options = bracket
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export const openscadBackend: ModelingBackend = {
  id: "openscad",
  name: "OpenSCAD",
  sourceExt: ".scad",
  exports: ["stl", "3mf"],
  skillId: "openscad",

  async detect(): Promise<BackendStatus> {
    const path = await resolveOpenscad();
    return path
      ? { available: true, detail: path }
      : { available: false, detail: "not found", missing: ["openscad"] };
  },

  async render({
    modelPath,
    outDir,
    cameras,
    size,
  }: RenderRequest): Promise<string[]> {
    const osc = await bin();
    const base = basename(modelPath, ".scad");
    const out: string[] = [];
    for (const cam of cameras) {
      const png = join(outDir, `${base}_${cam}.png`);
      await run(osc, [
        "--render",
        modelPath,
        "-o",
        png,
        `--camera=${CAMERA_ARGS[cam]}`,
        `--imgsize=${size[0]},${size[1]}`,
      ]);
      out.push(png);
    }
    return out;
  },

  async export(modelPath: string, format: ExportFormat): Promise<string> {
    const osc = await bin();
    const out = modelPath.replace(".scad", `.${format}`);
    await run(osc, [modelPath, "-o", out]);
    return out;
  },

  async validate(modelPath: string): Promise<ValidationResult> {
    const osc = await resolveOpenscad();
    if (!osc) return { ok: false, errors: ["OpenSCAD not found"] };
    // `echo` export parses + evaluates without GL/CGAL render — fast and
    // portable (no /dev/null). Non-zero exit ⇒ syntax/eval error.
    const tmp = join(tmpdir(), `opencad-validate-${process.pid}.echo`);
    const { code, stderr } = await spawnAsync(osc, [
      "--export-format=echo",
      "-o",
      tmp,
      modelPath,
    ]);
    await rm(tmp, { force: true }).catch(() => {});
    return { ok: code === 0, errors: stderr.split("\n").filter(Boolean) };
  },

  async extractParams(source: string): Promise<Param[]> {
    const params: Param[] = [];
    // name = value;  // [range/options] description
    const assign = /^\s*([A-Za-z_]\w*)\s*=\s*([^;]+);\s*(?:\/\/\s*(.*))?$/;
    let depth = 0;
    source.split("\n").forEach((line, i) => {
      const before = depth;
      depth += count(line, "{") - count(line, "}");
      if (before > 0) return; // skip vars inside modules/functions
      const m = assign.exec(line);
      if (!m) return;
      const { type, value } = classify((m[2] ?? "").trim());
      const param: Param = { name: m[1] ?? "", value, type, line: i };
      parseComment((m[3] ?? "").trim(), param);
      params.push(param);
    });
    return params;
  },
};
