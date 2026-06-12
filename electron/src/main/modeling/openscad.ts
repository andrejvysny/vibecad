import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import { cleanSpawnEnv } from "../spawn-env.js";
import type {
  BackendStatus,
  CameraPreset,
  ExportFormat,
  ModelingBackend,
  Param,
  RenderRequest,
  ValidationResult,
} from "../../../../shared/types.js";

const execFileAsync = promisify(execFile);

async function which(bin: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(cmd, [bin]);
    return stdout.trim().split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

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

export const openscadBackend: ModelingBackend = {
  id: "openscad",
  name: "OpenSCAD",
  sourceExt: ".scad",
  exports: ["stl", "3mf"],
  skillId: "openscad",

  async detect(): Promise<BackendStatus> {
    const path = await which("openscad");
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
    const base = basename(modelPath, ".scad");
    const out: string[] = [];
    for (const cam of cameras) {
      const png = join(outDir, `${base}_${cam}.png`);
      await run("openscad", [
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
    const out = modelPath.replace(".scad", `.${format}`);
    await run("openscad", [modelPath, "-o", out]);
    return out;
  },

  async validate(modelPath: string): Promise<ValidationResult> {
    const { code, stderr } = await spawnAsync("openscad", [
      "--check-parameters",
      modelPath,
    ]);
    return { ok: code === 0, errors: stderr.split("\n").filter(Boolean) };
  },

  async extractParams(source: string): Promise<Param[]> {
    const params: Param[] = [];
    const re = /^(\w+)\s*=\s*([\d.]+)\s*;/gm;
    let match: RegExpExecArray | null;
    const lines = source.split("\n");
    while ((match = re.exec(source)) !== null) {
      const lineIndex = source.slice(0, match.index).split("\n").length - 1;
      params.push({
        name: match[1] ?? "",
        value: parseFloat(match[2] ?? "0"),
        line: lineIndex,
      });
    }
    void lines;
    return params;
  },
};
