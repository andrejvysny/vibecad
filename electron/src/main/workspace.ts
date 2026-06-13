import { existsSync, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import log from "electron-log/main";

const WATCHED = new Map<string, ReturnType<typeof watch>[]>();

/**
 * A project's file list for the renderer: root entries plus `parts/<f>` relative
 * subpaths (multi-part sources live one level down). Missing `parts/` is fine.
 */
export async function enumerateProjectFiles(
  projectDir: string,
): Promise<string[]> {
  const root = await readdir(projectDir).catch(() => [] as string[]);
  let parts: string[] = [];
  try {
    parts = (await readdir(join(projectDir, "parts"))).map((f) => `parts/${f}`);
  } catch {
    parts = [];
  }
  return [...root, ...parts];
}

export function watchProject(
  projectId: string,
  projectDir: string,
  onChange: (projectId: string, files: string[]) => void,
): void {
  if (WATCHED.has(projectId)) return;

  const emit = (): void => {
    enumerateProjectFiles(projectDir)
      .then((files) => onChange(projectId, files))
      .catch((err) => log.error(`[workspace] enumerate error:`, err));
  };

  // fs.watch isn't recursive on Linux, so watch the project root and the
  // `parts/` dir separately; either firing re-enumerates the whole project.
  const watchers = [watch(projectDir, { recursive: false }, emit)];
  const partsDir = join(projectDir, "parts");
  if (existsSync(partsDir)) {
    watchers.push(watch(partsDir, { recursive: false }, emit));
  }

  WATCHED.set(projectId, watchers);
  log.info(`[workspace] watching ${projectDir}`);
}

export function unwatchProject(projectId: string): void {
  WATCHED.get(projectId)?.forEach((w) => w.close());
  WATCHED.delete(projectId);
}
