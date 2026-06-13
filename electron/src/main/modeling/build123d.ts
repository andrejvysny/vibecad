import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { cleanSpawnEnv } from "../spawn-env.js";
import { getSkillsBase } from "../paths.js";
import { parseBrepDiagnostics } from "../diagnostics/brep.js";
import { classify, parseComment, sectionOf } from "./param-comments.js";
import type {
  BackendStatus,
  ExportFormat,
  ModelDiagnostics,
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

/** Path to a build123d-managed venv interpreter, if one exists. */
function managedVenvPython(): string | null {
  const sub =
    process.platform === "win32"
      ? ["Scripts", "python.exe"]
      : ["bin", "python3"];
  const p = join(homedir(), "openscad-studio", ".venv", ...sub);
  return existsSync(p) ? p : null;
}

/**
 * Resolve the Python interpreter for build123d. The system `python3` is often
 * too new for OCP wheels, so prefer an explicit override or the managed venv.
 * Order: OPENCAD_PYTHON env → ~/openscad-studio/.venv → python3 → python.
 */
async function resolvePythonBin(): Promise<string | null> {
  const override = process.env.OPENCAD_PYTHON?.trim();
  if (override && existsSync(override)) return override;
  return (
    managedVenvPython() ?? (await which("python3")) ?? (await which("python"))
  );
}

/** f3d is a CLI binary — verify it actually runs (a present-but-broken install
 *  still resolves on PATH but fails to load its dylibs). */
async function f3dWorks(): Promise<boolean> {
  try {
    await execFileAsync("f3d", ["--version"]);
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

/** Like spawnAsync but also captures stdout (the diagnostics JSON). */
function spawnCapture(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanSpawnEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

let resolvedPython: string | null = null;

export const build123dBackend: ModelingBackend = {
  id: "build123d",
  name: "build123d",
  sourceExt: ".py",
  exports: ["stl", "3mf", "step", "dxf"],
  skillId: "build123d",

  async detect(): Promise<BackendStatus> {
    const py = await resolvePythonBin();
    if (!py)
      return { available: false, detail: "no python", missing: ["python"] };

    const hasBuild123d = await pythonHas(py, "build123d");
    // f3d is a standalone CLI the harness shells out to for PNG previews
    // (render_harness.py). In-app STEP/STL viewing uses the WASM viewer, so f3d
    // is reported as missing but does NOT gate availability — only build123d does.
    const missing: string[] = [];
    if (!hasBuild123d) missing.push("build123d");
    if (!(await f3dWorks())) missing.push("f3d");

    if (!hasBuild123d) return { available: false, detail: py, missing };

    resolvedPython = py;
    return {
      available: true,
      detail: py,
      missing: missing.length ? missing : undefined,
    };
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

  async brepDiagnostics(modelPath: string): Promise<ModelDiagnostics | null> {
    const py = resolvedPython;
    if (!py) return null;
    const { code, stdout } = await spawnCapture(py, [
      getHarnessPath(),
      modelPath,
      "--diagnostics",
    ]);
    if (code !== 0) return null;
    return parseBrepDiagnostics(stdout);
  },

  async extractParams(source: string): Promise<Param[]> {
    const params: Param[] = [];
    // top-level `name = <literal>` with an optional `# PARAM [..] desc` annotation
    const assign =
      /^(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^#\n]+?)\s*(?:#\s*(.*))?$/;
    let section: string | undefined;
    source.split("\n").forEach((line, i) => {
      if (/^\s/.test(line)) return; // top-level assignments only
      const sec = sectionOf(line);
      if (sec !== null) {
        section = sec;
        return;
      }
      const m = assign.exec(line);
      if (!m) return;
      const { type, value } = classify((m[2] ?? "").trim());
      if (type === "expression" || type === "array") return; // not editable
      const param: Param = { name: m[1] ?? "", value, type, line: i };
      const comment = (m[3] ?? "").trim();
      if (/^PARAM\b/i.test(comment)) {
        parseComment(comment.replace(/^PARAM\s*/i, ""), param);
      }
      if (section) param.section = section;
      params.push(param);
    });
    return params;
  },
};
