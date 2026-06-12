import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import log from "electron-log/main";

const WATCHED = new Map<string, ReturnType<typeof watch>>();

export function watchProject(
  projectId: string,
  projectDir: string,
  onChange: (projectId: string, files: string[]) => void,
): void {
  if (WATCHED.has(projectId)) return;

  const watcher = watch(projectDir, { recursive: false }, () => {
    readdir(projectDir)
      .then((files) => onChange(projectId, files))
      .catch((err) => log.error(`[workspace] readdir error:`, err));
  });

  WATCHED.set(projectId, watcher);
  log.info(`[workspace] watching ${projectDir}`);
}

export function unwatchProject(projectId: string): void {
  WATCHED.get(projectId)?.close();
  WATCHED.delete(projectId);
}
