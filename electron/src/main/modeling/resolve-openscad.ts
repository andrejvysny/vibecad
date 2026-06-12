import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Resolution is stable for a session, so cache the first successful lookup.
let cached: Promise<string | null> | undefined;

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function onPath(): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(cmd, ["openscad"]);
    return stdout.trim().split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

/** macOS .app bundles, newest-named first (covers `OpenSCAD-2021.01.app`). */
async function macAppCandidates(): Promise<string[]> {
  const out = ["/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"];
  try {
    const apps = (await readdir("/Applications"))
      .filter((n) => /^OpenSCAD.*\.app$/i.test(n))
      .sort()
      .reverse();
    for (const app of apps) {
      out.push(`/Applications/${app}/Contents/MacOS/OpenSCAD`);
    }
  } catch {
    /* /Applications unreadable — ignore */
  }
  return out;
}

async function locate(): Promise<string | null> {
  const override = process.env["OPENCAD_OPENSCAD_PATH"];
  if (override && (await isExecutable(override))) return override;

  const path = await onPath();
  if (path && (await isExecutable(path))) return path;

  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(...(await macAppCandidates()));
  }
  candidates.push("/opt/homebrew/bin/openscad", "/usr/local/bin/openscad");

  for (const c of candidates) {
    if (await isExecutable(c)) return c;
  }
  return null;
}

/**
 * Absolute path to a usable OpenSCAD binary, or null. Checks (in order) an
 * `OPENCAD_OPENSCAD_PATH` override, `PATH`, then common macOS/Homebrew install
 * locations — so the app finds OpenSCAD even when it isn't on `PATH`
 * (e.g. only installed as `/Applications/OpenSCAD-2021.01.app`).
 */
export function resolveOpenscad(): Promise<string | null> {
  if (!cached) cached = locate();
  return cached;
}
