import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import { cleanSpawnEnv } from "../spawn-env.js";
import { getSkillsBase } from "../paths.js";
import type {
  BackendStatus,
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

async function pythonHas(pyPath: string, module: string): Promise<boolean> {
  try {
    await execFileAsync(pyPath, ["-c", `import ${module}`]);
    return true;
  } catch {
    return false;
  }
}

function getHarnessPath(): string {
  return join(getSkillsBase(), "build123d", "render_harness.py");
}

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

/** Run the harness and throw with stderr if it exits non-zero. */
async function run(cmd: string, args: string[]): Promise<void> {
  const { code, stderr } = await spawnAsync(cmd, args);
  if (code !== 0) {
    throw new Error(stderr.trim() || `${cmd} exited with code ${code}`);
  }
}

let resolvedPython: string | null = null;

export const build123dBackend: ModelingBackend = {
  id: "build123d",
  name: "build123d",
  sourceExt: ".py",
  exports: ["stl", "3mf", "step", "dxf"],
  skillId: "build123d",

  async detect(): Promise<BackendStatus> {
    const py = (await which("python3")) ?? (await which("python"));
    if (!py)
      return { available: false, detail: "no python", missing: ["python"] };

    const missing: string[] = [];
    for (const dep of ["build123d", "f3d"]) {
      if (!(await pythonHas(py, dep))) missing.push(dep);
    }

    if (missing.length > 0) return { available: false, detail: py, missing };

    resolvedPython = py;
    return { available: true, detail: py };
  },

  async render({
    modelPath,
    outDir,
    cameras,
    size,
  }: RenderRequest): Promise<string[]> {
    const py = resolvedPython;
    if (!py) throw new Error("build123d not available — run detect() first");
    const harness = getHarnessPath();
    const base = basename(modelPath, ".py");
    const out: string[] = [];
    for (const cam of cameras) {
      const png = join(outDir, `${base}_${cam}.png`);
      await run(py, [
        harness,
        modelPath,
        "--camera",
        cam,
        "--out",
        png,
        "--size",
        `${size[0]}x${size[1]}`,
      ]);
      out.push(png);
    }
    return out;
  },

  async export(modelPath: string, format: ExportFormat): Promise<string> {
    const py = resolvedPython;
    if (!py) throw new Error("build123d not available");
    const harness = getHarnessPath();
    const out = modelPath.replace(".py", `.${format}`);
    await run(py, [harness, modelPath, "--export", format, "--out", out]);
    return out;
  },

  async validate(modelPath: string): Promise<ValidationResult> {
    const py = resolvedPython;
    if (!py) return { ok: false, errors: ["build123d not available"] };
    const harness = getHarnessPath();
    const { code, stderr } = await spawnAsync(py, [
      harness,
      modelPath,
      "--check",
    ]);
    return { ok: code === 0, errors: stderr.split("\n").filter(Boolean) };
  },

  async extractParams(source: string): Promise<Param[]> {
    const params: Param[] = [];
    const re = /^(\w+)\s*=\s*([\d.]+)\s*(?:#.*)?$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const lineIndex = source.slice(0, match.index).split("\n").length - 1;
      params.push({
        name: match[1] ?? "",
        value: parseFloat(match[2] ?? "0"),
        line: lineIndex,
      });
    }
    return params;
  },
};
