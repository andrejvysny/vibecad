import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import log from "electron-log/main";
import { eq } from "drizzle-orm";
import { detectAgents, getAdapter, killActive } from "./agents/index.js";
import { detectBackends, getBackend } from "./modeling/index.js";
import { initDb } from "./db/index.js";
import { projects } from "./db/schema.js";
import { watchWorkspace } from "./workspace.js";
import type {
  RunAgentPayload,
  StopAgentPayload,
  ExportModelPayload,
  OpenModelPayload,
} from "../../../shared/ipc.js";

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

function getSkillsDir(backendId: string): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(__dirname, "../../../../skills");
  return join(base, backendId);
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
    watchWorkspace((projectId, files) => {
      mainWindow?.webContents.send("workspace:changed", { projectId, files });
    });
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
