import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import log from "electron-log/main";
import { eq } from "drizzle-orm";
import {
  detectAgents,
  getAdapter,
  killActive,
  registerActive,
} from "./agents/index.js";
import { detectBackends, getBackend } from "./modeling/index.js";
import { initDb } from "./db/index.js";
import { projects } from "./db/schema.js";
import {
  createProject,
  getProject,
  listProjects,
  type ProjectRow,
} from "./projects.js";
import { getSkillsDir } from "./paths.js";
import { unwatchProject, watchProject } from "./workspace.js";
import type {
  RunAgentPayload,
  StopAgentPayload,
  ExportModelPayload,
  OpenModelPayload,
  RenderModelPayload,
  CreateProjectPayload,
  GetProjectPayload,
  ProjectRecord,
} from "../../../shared/ipc.js";
import type { CameraPreset } from "../../../shared/types.js";

log.initialize();

if (!app.isPackaged) {
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
}

log.info(
  `[boot] OpenSCAD Studio ${app.getVersion()} | packaged=${app.isPackaged} | platform=${process.platform}-${process.arch}`,
);

let mainWindow: BrowserWindow | null = null;

function getRendererUrl(): string {
  if (!app.isPackaged) return "http://127.0.0.1:1420";
  return `file://${join(process.resourcesPath, "renderer", "index.html")}`;
}

function toRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    dir: row.dir,
    agentId: row.agentId as ProjectRecord["agentId"],
    modelingBackend: row.modelingBackend,
    outputNeed: row.outputNeed,
  };
}

// Watch the single active project's dir; push file lists to the renderer.
let watchedProjectId: string | null = null;

function emitFiles(projectId: string, files: string[]): void {
  mainWindow?.webContents.send("workspace:changed", { projectId, files });
}

async function setActiveWatch(projectId: string, dir: string): Promise<void> {
  if (watchedProjectId && watchedProjectId !== projectId) {
    unwatchProject(watchedProjectId);
  }
  watchedProjectId = projectId;
  watchProject(projectId, dir, emitFiles);
  // Emit the current contents immediately so previews populate without waiting
  // for the next fs event.
  try {
    emitFiles(projectId, await readdir(dir));
  } catch (err) {
    log.error("[workspace] initial readdir failed:", err);
  }
}

function installSecurityPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(false);
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {};
    const devCsp = [
      "default-src 'self' http://127.0.0.1:*",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://127.0.0.1:*",
      "style-src 'self' 'unsafe-inline' http://127.0.0.1:*",
      "img-src 'self' data: blob: http://127.0.0.1:* file:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    const prodCsp = [
      "default-src 'self' file:",
      "script-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: file:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    headers["Content-Security-Policy"] = [app.isPackaged ? prodCsp : devCsp];
    callback({ responseHeaders: headers });
  });
}

const TITLEBAR_HEIGHT = 36;

function createWindow(): void {
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "OpenSCAD Studio",
    backgroundColor: "#0f1117",
    show: false,
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : {
          titleBarOverlay: {
            color: "#0f1117",
            symbolColor: "#f3f4f6",
            height: TITLEBAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (!app.isPackaged) mainWindow?.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged
      ? /^file:\/\//.test(url)
      : /^http:\/\/127\.0\.0\.1:1420/.test(url);
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log.error(`[window] did-fail-load ${url}: ${code} ${desc}`);
  });
}

// ──── IPC: agent ────────────────────────────────────────────────────────────

ipcMain.handle("agent:detect", async () => {
  return detectAgents();
});

ipcMain.handle("agent:run", async (_e, payload: RunAgentPayload) => {
  const { prompt, projectId, sessionId } = payload;

  // Fetch project to determine backend + working dir
  const db = initDb();
  const [project] = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .all();

  if (!project) throw new Error(`Project not found: ${projectId}`);

  const adapter = getAdapter(
    project.agentId as Parameters<typeof getAdapter>[0],
  );
  if (!adapter) throw new Error(`Agent not found: ${project.agentId}`);

  const skillsDir = getSkillsDir(project.modelingBackend);

  const child = adapter.spawn({
    prompt,
    workingDir: project.dir,
    skillsDir,
    sessionId,
  });
  registerActive(projectId, child);

  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      const event = adapter.parseEvent(line);
      mainWindow?.webContents.send("agent:event", event);
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    log.warn(`[agent:${project.agentId}] stderr: ${chunk.toString()}`);
  });

  return new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      log.info(`[agent:${project.agentId}] exited code=${code}`);
      mainWindow?.webContents.send("agent:event", {
        type: "done",
        payload: { code },
      });
      resolve();
    });
    child.on("error", (err) => {
      log.error(`[agent:${project.agentId}] error:`, err);
      mainWindow?.webContents.send("agent:event", {
        type: "error",
        payload: err.message,
      });
      reject(err);
    });
  });
});

ipcMain.handle("agent:stop", (_e, payload: StopAgentPayload) => {
  killActive(payload.projectId);
});

// ──── IPC: modeling backend ──────────────────────────────────────────────────

ipcMain.handle("backend:detect", async () => {
  return detectBackends();
});

ipcMain.handle("model:export", async (_e, payload: ExportModelPayload) => {
  const { modelPath, format } = payload;
  const ext = modelPath.endsWith(".scad") ? ".scad" : ".py";
  const backendId = ext === ".scad" ? "openscad" : "build123d";
  const backend = getBackend(backendId);
  if (!backend) throw new Error(`Backend not available: ${backendId}`);
  return backend.export(modelPath, format);
});

ipcMain.handle("model:open", (_e, payload: OpenModelPayload) => {
  void shell.openPath(payload.modelPath);
});

ipcMain.handle("model:render", async (_e, payload: RenderModelPayload) => {
  const { projectId, backendId, modelPath, outDir } = payload;
  const backend = getBackend(backendId);
  if (!backend) throw new Error(`Backend not available: ${backendId}`);
  // build123d's render() needs detect() to have resolved a python path first.
  await backend.detect();
  const cameras: CameraPreset[] = ["front", "top", "iso"];
  const pngs = await backend.render({
    modelPath,
    outDir,
    cameras,
    size: [800, 600],
  });
  for (const png of pngs) {
    const angle = /_(front|top|iso)\.png$/.exec(png)?.[1] as
      | CameraPreset
      | undefined;
    if (angle) {
      mainWindow?.webContents.send("preview:updated", {
        projectId,
        angle,
        pngPath: png,
      });
    }
  }
  return pngs;
});

// ──── IPC: project ───────────────────────────────────────────────────────────

ipcMain.handle("project:create", async (_e, payload: CreateProjectPayload) => {
  const row = await createProject(payload);
  await setActiveWatch(row.id, row.dir);
  return toRecord(row);
});

ipcMain.handle("project:list", () => listProjects().map(toRecord));

ipcMain.handle("project:open", async (_e, payload: GetProjectPayload) => {
  const row = getProject(payload.id);
  if (!row) throw new Error(`Project not found: ${payload.id}`);
  await setActiveWatch(row.id, row.dir);
  return toRecord(row);
});

// ──── IPC: app ───────────────────────────────────────────────────────────────

ipcMain.handle("app:get-versions", () => ({
  app: app.getVersion(),
  electron: process.versions["electron"],
  chromium: process.versions["chrome"],
  node: process.versions["node"],
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.handle(
  "window:set-overlay-theme",
  (_e, theme: { color: string; symbolColor: string }) => {
    if (process.platform === "darwin" || !mainWindow) return;
    try {
      mainWindow.setTitleBarOverlay({
        color: theme.color,
        symbolColor: theme.symbolColor,
        height: TITLEBAR_HEIGHT,
      });
    } catch {
      // ignore: titleBarOverlay not enabled
    }
  },
);

// ──── Boot ───────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  installSecurityPolicy();
  initDb();
  createWindow();

  if (mainWindow) {
    mainWindow.loadURL(getRendererUrl());
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      mainWindow?.loadURL(getRendererUrl());
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
