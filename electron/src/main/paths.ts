import { app } from "electron";
import { join } from "node:path";

// Main is bundled by tsup to electron/dist/main/index.js, so __dirname is
// electron/dist/main at runtime → ../../../ reaches the repo root, where the
// bundled `skills/` lives in dev. Packaged builds ship it under resources.
function getResourcesBase(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, "../../..");
}

/** Base dir holding one skill folder per modeling backend. */
export function getSkillsBase(): string {
  return join(getResourcesBase(), "skills");
}

/** Skill dir for a given modeling backend (passed to the agent). */
export function getSkillsDir(backendId: string): string {
  return join(getSkillsBase(), backendId);
}
