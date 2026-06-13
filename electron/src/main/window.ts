import type { BrowserWindow } from "electron";

// The single main window lives here (not in index.ts) so that agent-run and
// preview modules can push events to the renderer without importing index.ts
// (which would create a cycle through the IPC handlers).
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Push an event to the renderer (no-op when the window is gone). */
export function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}
