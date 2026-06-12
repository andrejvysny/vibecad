import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import log from "electron-log/main";
import { eq } from "drizzle-orm";
import {
  detectAgents,
  getAdapter,
  killActive,
  registerActive,
} from "./agents/index.js";
import { detectBackends, getBackend } from "./modeling/index.js";
import { resolveOpenscad } from "./modeling/resolve-openscad.js";
import { initDb } from "./db/index.js";
import { projects } from "./db/schema.js";
import {
  createProject,
  getProject,
  getWorkspaceRoot,
  listProjects,
  type ProjectRow,
} from "./projects.js";
import {
  getOrCreateSession,
  insertMessage,
  listMessages,
  setAgentSessionId,
} from "./chat.js";
import { getSkillsDir } from "./paths.js";
import { unwatchProject, watchProject } from "./workspace.js";
import type {
  RunAgentPayload,
  StopAgentPayload,
  ExportModelPayload,
  ExtractParamsPayload,
  SetParamPayload,
  PreviewMeshPayload,
  ReadModelPayload,
  RevealPayload,
  CreateProjectPayload,
  GetProjectPayload,
  ProjectRecord,
  ChatHistoryPayload,
  PickImagesPayload,
  SaveAttachmentPayload,
} from "../../../shared/ipc.js";
import type { AgentEvent } from "../../../shared/types.js";

log.initialize();

// Must run before app `ready`. `studio://` serves project files to the renderer
// (the renderer's http/file origin cannot load `file://` under webSecurity).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "studio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

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
      "img-src 'self' data: blob: http://127.0.0.1:* studio:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* studio:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    const prodCsp = [
      "default-src 'self' file:",
      "script-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: studio:",
      "connect-src 'self' studio:",
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

/** Append image attachment paths to the prompt so the agent reads them. */
function withAttachments(prompt: string, attachments?: string[]): string {
  if (!attachments?.length) return prompt;
  const list = attachments.map((p) => `- ${p}`).join("\n");
  return `${prompt}\n\nAttached image(s) for reference (read them):\n${list}`;
}

ipcMain.handle("agent:run", async (_e, payload: RunAgentPayload) => {
  const { prompt, projectId, attachments } = payload;

  // Fetch project to determine agent/backend + working dir
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

  // Expose the resolved OpenSCAD binary so the agent's headless validation
  // works even when OpenSCAD isn't on PATH (the skill reads $OPENSCAD_BIN).
  const env: Record<string, string> = {};
  if (project.modelingBackend === "openscad") {
    const osc = await resolveOpenscad();
    if (osc) env["OPENSCAD_BIN"] = osc;
  }

  // Persist the user turn + resolve a resumable session.
  const session = getOrCreateSession(projectId, project.agentId);
  insertMessage(session.id, "user", prompt);

  const child = adapter.spawn({
    prompt: withAttachments(prompt, attachments),
    workingDir: project.dir,
    skillsDir,
    sessionId: session.agentSessionId ?? undefined,
    env,
  });
  registerActive(projectId, adapter.id, child);

  // Accumulate the assistant turn so it can be persisted on close.
  let assistantText = "";
  const toolEvents: AgentEvent[] = [];

  const emit = (event: AgentEvent): void => {
    if (event.type === "session") {
      setAgentSessionId(session.id, event.payload.sessionId);
    } else if (event.type === "text_delta") {
      assistantText += event.payload.text;
    } else if (event.type === "tool_use" || event.type === "tool_result") {
      toolEvents.push(event);
    } else if (event.type === "done" && event.payload.sessionId) {
      setAgentSessionId(session.id, event.payload.sessionId);
    }
    mainWindow?.webContents.send("agent:event", event);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      for (const event of adapter.parseEvent(line)) emit(event);
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    log.warn(`[agent:${project.agentId}] stderr: ${chunk.toString()}`);
  });

  const persistAssistant = (): void => {
    insertMessage(
      session.id,
      "assistant",
      assistantText,
      toolEvents.length ? JSON.stringify(toolEvents) : undefined,
    );
  };

  return new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      log.info(`[agent:${project.agentId}] exited code=${code}`);
      persistAssistant();
      mainWindow?.webContents.send("agent:event", {
        type: "done",
        payload: {},
      } satisfies AgentEvent);
      // Auto-render the latest model so the preview is deterministic.
      void renderLatest(projectId);
      resolve();
    });
    child.on("error", (err) => {
      log.error(`[agent:${project.agentId}] error:`, err);
      mainWindow?.webContents.send("agent:event", {
        type: "error",
        payload: { message: err.message },
      } satisfies AgentEvent);
      reject(err);
    });
  });
});

ipcMain.handle("agent:stop", (_e, payload: StopAgentPayload) => {
  killActive(payload.projectId);
});

ipcMain.handle("chat:history", (_e, payload: ChatHistoryPayload) =>
  listMessages(payload.projectId),
);

// ──── IPC: chat attachments ──────────────────────────────────────────────────

async function attachmentsDir(projectId: string): Promise<string> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const dir = join(project.dir, ".attachments");
  await mkdir(dir, { recursive: true });
  return dir;
}

ipcMain.handle("chat:pick-images", async (_e, payload: PickImagesPayload) => {
  if (!mainWindow) return [];
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
    ],
  });
  if (canceled) return [];
  const dir = await attachmentsDir(payload.projectId);
  const saved: string[] = [];
  for (const src of filePaths) {
    const dest = join(dir, `${Date.now()}_${basename(src)}`);
    await copyFile(src, dest);
    saved.push(dest);
  }
  return saved;
});

ipcMain.handle(
  "chat:save-attachment",
  async (_e, payload: SaveAttachmentPayload) => {
    const dir = await attachmentsDir(payload.projectId);
    const safeName = basename(payload.name).replace(/[^\w.\-]/g, "_");
    const dest = join(dir, `${Date.now()}_${safeName}`);
    await writeFile(dest, Buffer.from(payload.dataBase64, "base64"));
    return dest;
  },
);

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

/** The newest model_NNN source file in a project, or null. */
async function latestModel(project: ProjectRow): Promise<string | null> {
  const ext = project.modelingBackend === "openscad" ? ".scad" : ".py";
  const latest = (await readdir(project.dir))
    .filter((f) => /^model_\d+/.test(f) && f.endsWith(ext))
    .sort()
    .at(-1);
  return latest ? join(project.dir, latest) : null;
}

/**
 * Export the preview mesh (STL) for a model and notify the renderer. STL export
 * is headless (CGAL/CPU, no GL) so it never triggers the GUI-render crash.
 */
async function exportPreviewMesh(
  projectId: string,
  modelPath: string,
): Promise<string> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const backend = getBackend(project.modelingBackend);
  if (!backend)
    throw new Error(`Backend not available: ${project.modelingBackend}`);
  const status = await backend.detect();
  if (!status.available) {
    throw new Error(
      `${backend.name} not available${status.missing ? ` (missing: ${status.missing.join(", ")})` : ""}`,
    );
  }
  const stlPath = await backend.export(modelPath, "stl");
  mainWindow?.webContents.send("preview:mesh-ready", { projectId, stlPath });
  return stlPath;
}

/** Find the newest model in a project and export its preview mesh. */
async function renderLatest(projectId: string): Promise<void> {
  try {
    const project = getProject(projectId);
    if (!project) return;
    const modelPath = await latestModel(project);
    if (!modelPath) return;
    await exportPreviewMesh(projectId, modelPath);
  } catch (err) {
    log.error("[preview] mesh export failed:", err);
    mainWindow?.webContents.send("preview:error", {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

ipcMain.handle(
  "model:preview-mesh",
  async (_e, payload: PreviewMeshPayload) => {
    const project = getProject(payload.projectId);
    if (!project) throw new Error(`Project not found: ${payload.projectId}`);
    const modelPath = payload.modelPath ?? (await latestModel(project));
    if (!modelPath) throw new Error("No model to preview");
    return exportPreviewMesh(payload.projectId, modelPath);
  },
);

ipcMain.handle("model:read", async (_e, payload: ReadModelPayload) => {
  const abs = resolve(payload.path);
  if (!isInsideWorkspace(abs)) throw new Error("Path outside workspace");
  return readFile(abs, "utf8");
});

/** Resolve the model source path for a param request (active or latest). */
async function paramModelPath(
  projectId: string,
  modelPath?: string,
): Promise<{ project: ProjectRow; path: string }> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const path = modelPath ?? (await latestModel(project));
  if (!path) throw new Error("No model to inspect");
  if (!isInsideWorkspace(resolve(path)))
    throw new Error("Path outside workspace");
  return { project, path };
}

ipcMain.handle(
  "model:extract-params",
  async (_e, payload: ExtractParamsPayload) => {
    const { project, path } = await paramModelPath(
      payload.projectId,
      payload.modelPath,
    );
    const backend = getBackend(project.modelingBackend);
    if (!backend) return [];
    const source = await readFile(path, "utf8");
    return backend.extractParams(source);
  },
);

/** Render a JS value back into source syntax (shared by .scad and .py). */
function formatParamValue(v: number | string | boolean): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v); // quoted string
}

/** Replace only the RHS value on `lineIdx`, preserving any trailing comment. */
function patchSourceLine(
  source: string,
  lineIdx: number,
  ext: ".scad" | ".py",
  formatted: string,
): string | null {
  const lines = source.split("\n");
  const line = lines[lineIdx];
  if (line === undefined) return null;
  const eq = line.indexOf("=");
  if (eq === -1) return null;
  const prefix = line.slice(0, eq + 1).trimEnd();
  const rest = line.slice(eq + 1);
  if (ext === ".scad") {
    const semi = rest.indexOf(";");
    if (semi === -1) return null;
    lines[lineIdx] = `${prefix} ${formatted}${rest.slice(semi)}`;
  } else {
    const hash = rest.indexOf("#");
    const tail = hash === -1 ? "" : `  ${rest.slice(hash)}`;
    lines[lineIdx] = `${prefix} ${formatted}${tail}`;
  }
  return lines.join("\n");
}

ipcMain.handle("model:set-param", async (_e, payload: SetParamPayload) => {
  const { project, path } = await paramModelPath(
    payload.projectId,
    payload.modelPath,
  );
  const backend = getBackend(project.modelingBackend);
  if (!backend) throw new Error(`Backend not available`);
  const original = await readFile(path, "utf8");
  const params = await backend.extractParams(original);
  const param = params.find((p) => p.name === payload.name);
  if (!param) throw new Error(`Parameter not found: ${payload.name}`);
  const patched = patchSourceLine(
    original,
    param.line,
    backend.sourceExt,
    formatParamValue(payload.value),
  );
  if (patched === null) throw new Error(`Could not patch ${payload.name}`);
  await writeFile(path, patched, "utf8");
  // Guard: revert if the edit breaks parsing/evaluation (build123d esp.).
  const validation = await backend.validate(path);
  if (!validation.ok) {
    await writeFile(path, original, "utf8");
    return { ok: false, errors: validation.errors };
  }
  await exportPreviewMesh(payload.projectId, path);
  return { ok: true, errors: [] };
});

ipcMain.handle("shell:reveal", (_e, payload: RevealPayload) => {
  shell.showItemInFolder(resolve(payload.path));
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

// ──── studio:// protocol ─────────────────────────────────────────────────────

/** True if `abs` resolves inside the workspace root (anti-traversal guard). */
function isInsideWorkspace(abs: string): boolean {
  const root = resolve(getWorkspaceRoot());
  return abs === root || abs.startsWith(root + sep);
}

/** Serve project files to the renderer: studio://local/<urlencoded-abs-path>. */
function registerStudioProtocol(): void {
  protocol.handle("studio", (request) => {
    const encoded = request.url.slice("studio://local/".length);
    const abs = resolve(decodeURIComponent(encoded));
    if (!isInsideWorkspace(abs)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(abs).toString()).then((res) => {
      // Renderer origin (http://127.0.0.1:1420) fetches this cross-origin.
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    });
  });
}

// ──── Boot ───────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  installSecurityPolicy();
  registerStudioProtocol();
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
