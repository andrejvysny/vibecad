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
import { basename, delimiter, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import log from "electron-log/main";
import { detectAgents, killActive } from "./agents/index.js";
import { detectBackends, getBackend } from "./modeling/index.js";
import { initDb } from "./db/index.js";
import {
  addReference,
  createProject,
  deleteProject,
  getProject,
  getWorkspaceRoot,
  importSkill,
  listProjects,
  listReferences,
  listSkills,
  readInstructions,
  removeReference,
  removeSkill,
  renameProject,
  setProjectAgent,
  setProjectModel,
  writeInstructions,
  type ProjectRow,
} from "./projects.js";
import { listMessages, resetSessionAgent } from "./chat.js";
import { deleteWorkflow, listWorkflows, saveWorkflow } from "./workflows.js";
import { unwatchProject, watchProject } from "./workspace.js";
import { getSkillsBase } from "./paths.js";
import { abortTurn, runAgentTurn, runWorkflow } from "./agent-run.js";
import { exportPreviewMesh, latestModel } from "./preview.js";
import { getMainWindow, setMainWindow, sendToRenderer } from "./window.js";
import type {
  RunAgentPayload,
  StopAgentPayload,
  ExportModelPayload,
  ExtractParamsPayload,
  SetParamPayload,
  PreviewMeshPayload,
  ReadModelPayload,
  RevealPayload,
  ImportStepPayload,
  CreateProjectPayload,
  GetProjectPayload,
  ReadInstructionsPayload,
  WriteInstructionsPayload,
  ListSkillsPayload,
  ImportSkillPayload,
  RemoveSkillPayload,
  ListReferencesPayload,
  AddReferencePayload,
  RemoveReferencePayload,
  ListWorkflowsPayload,
  SaveWorkflowPayload,
  DeleteWorkflowPayload,
  RunWorkflowPayload,
  DeleteProjectPayload,
  RenameProjectPayload,
  SetProjectAgentPayload,
  SetProjectModelPayload,
  ProjectRecord,
  ChatHistoryPayload,
  PickImagesPayload,
  SaveAttachmentPayload,
} from "../../../shared/ipc.js";

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
  `[boot] VibeCAD ${app.getVersion()} | packaged=${app.isPackaged} | platform=${process.platform}-${process.arch}`,
);

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
    agentModel: row.agentModel,
    modelingBackend: row.modelingBackend,
    outputNeed: row.outputNeed,
    createdAt: row.createdAt.getTime(),
  };
}

// Watch the single active project's dir; push file lists to the renderer.
let watchedProjectId: string | null = null;

function emitFiles(projectId: string, files: string[]): void {
  sendToRenderer("workspace:changed", { projectId, files });
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: http://127.0.0.1:*",
      "style-src 'self' 'unsafe-inline' http://127.0.0.1:*",
      "img-src 'self' data: blob: http://127.0.0.1:* studio:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* studio:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    const prodCsp = [
      "default-src 'self' file:",
      "script-src 'self' 'wasm-unsafe-eval' blob:",
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

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "VibeCAD",
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
  setMainWindow(win);

  win.once("ready-to-show", () => {
    win.show();
    if (!app.isPackaged) win.webContents.openDevTools();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged
      ? /^file:\/\//.test(url)
      : /^http:\/\/127\.0\.0\.1:1420/.test(url);
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  win.on("closed", () => {
    setMainWindow(null);
  });

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log.error(`[window] did-fail-load ${url}: ${code} ${desc}`);
  });
}

// ──── IPC: agent ────────────────────────────────────────────────────────────

ipcMain.handle("agent:detect", async () => {
  return detectAgents();
});

ipcMain.handle("agent:run", async (_e, payload: RunAgentPayload) => {
  await runAgentTurn(
    payload.projectId,
    payload.prompt,
    payload.attachments,
    payload.verify ?? false,
  );
});

ipcMain.handle("agent:stop", (_e, payload: StopAgentPayload) => {
  // Abort the self-repair loop first so it won't spawn another turn, then kill
  // the in-flight child.
  abortTurn(payload.projectId);
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
  const win = getMainWindow();
  if (!win) return [];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
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

// Pick an external STEP file and copy it into the project dir. The workspace
// fs.watch picks the new file up and pushes workspace:changed, so the tree
// refreshes on its own. Returns the new project-relative filename (or null).
ipcMain.handle("model:import-step", async (_e, payload: ImportStepPayload) => {
  const win = getMainWindow();
  if (!win) return null;
  const project = getProject(payload.projectId);
  if (!project) throw new Error(`Project not found: ${payload.projectId}`);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "STEP", extensions: ["step", "stp"] }],
  });
  const src = filePaths[0];
  if (canceled || !src) return null;
  // Normalize to a safe `.step` filename, avoiding collisions in the dir.
  const raw = basename(src).replace(/\.(step|stp)$/i, "");
  const safe = raw.replace(/[^\w.\-]/g, "_") || "imported";
  const existing = new Set(await readdir(project.dir));
  let name = `${safe}.step`;
  for (let i = 2; existing.has(name); i++) name = `${safe}_${i}.step`;
  await copyFile(src, join(project.dir, name));
  return name;
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
    // Preserve the original gap before a trailing `# PARAM …` comment instead of
    // collapsing it (don't reformat the agent's file on a param edit).
    const gap =
      hash === -1 ? "" : (rest.slice(0, hash).match(/\s+$/)?.[0] ?? "  ");
    const tail = hash === -1 ? "" : `${gap}${rest.slice(hash)}`;
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

ipcMain.handle("project:rename", (_e, payload: RenameProjectPayload) => {
  return toRecord(renameProject(payload.id, payload.name));
});

ipcMain.handle(
  "project:read-instructions",
  (_e, payload: ReadInstructionsPayload) => readInstructions(payload.projectId),
);

ipcMain.handle(
  "project:write-instructions",
  (_e, payload: WriteInstructionsPayload) => {
    writeInstructions(payload.projectId, payload.content);
  },
);

ipcMain.handle("project:list-skills", (_e, payload: ListSkillsPayload) =>
  listSkills(payload.projectId),
);

ipcMain.handle(
  "project:import-skill",
  async (_e, payload: ImportSkillPayload) => {
    const win = getMainWindow();
    if (win) {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Import skill (folder with SKILL.md, or a SKILL.md file)",
        properties: ["openFile", "openDirectory"],
        filters: [{ name: "Skill", extensions: ["md"] }],
      });
      if (!canceled)
        for (const src of filePaths) importSkill(payload.projectId, src);
    }
    return listSkills(payload.projectId);
  },
);

ipcMain.handle("project:remove-skill", (_e, payload: RemoveSkillPayload) => {
  removeSkill(payload.projectId, payload.name);
  return listSkills(payload.projectId);
});

ipcMain.handle(
  "project:list-references",
  (_e, payload: ListReferencesPayload) => listReferences(payload.projectId),
);

ipcMain.handle(
  "project:add-reference",
  async (_e, payload: AddReferencePayload) => {
    const win = getMainWindow();
    if (win) {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Add reference file(s)",
        properties: ["openFile", "multiSelections"],
      });
      if (!canceled)
        for (const src of filePaths) addReference(payload.projectId, src);
    }
    return listReferences(payload.projectId);
  },
);

ipcMain.handle(
  "project:remove-reference",
  (_e, payload: RemoveReferencePayload) => {
    removeReference(payload.projectId, payload.name);
    return listReferences(payload.projectId);
  },
);

// ──── IPC: workflows ─────────────────────────────────────────────────────────

ipcMain.handle("workflow:list", (_e, payload: ListWorkflowsPayload) =>
  listWorkflows(payload.projectId),
);

ipcMain.handle("workflow:save", (_e, payload: SaveWorkflowPayload) => {
  saveWorkflow(payload.projectId, payload.workflow);
  return listWorkflows(payload.projectId);
});

ipcMain.handle("workflow:delete", (_e, payload: DeleteWorkflowPayload) => {
  deleteWorkflow(payload.projectId, payload.slug);
  return listWorkflows(payload.projectId);
});

ipcMain.handle("workflow:run", async (_e, payload: RunWorkflowPayload) => {
  await runWorkflow(payload.projectId, payload.slug, payload.fromStep ?? 0);
});

ipcMain.handle("project:set-agent", (_e, payload: SetProjectAgentPayload) => {
  const row = setProjectAgent(payload.id, payload.agentId);
  // Drop the previous agent's resume id so the new agent starts a fresh session.
  resetSessionAgent(payload.id, payload.agentId);
  return toRecord(row);
});

ipcMain.handle("project:set-model", (_e, payload: SetProjectModelPayload) => {
  return toRecord(setProjectModel(payload.id, payload.model));
});

ipcMain.handle("project:delete", (_e, payload: DeleteProjectPayload) => {
  if (watchedProjectId === payload.id) {
    unwatchProject(payload.id);
    watchedProjectId = null;
  }
  deleteProject(payload.id);
  return { id: payload.id };
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
    const win = getMainWindow();
    if (process.platform === "darwin" || !win) return;
    try {
      win.setTitleBarOverlay({
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

/** Prepend the bundled OpenSCAD library dir (BOSL2) to OPENSCADPATH so both our
 *  headless exports and the agent's own `include <BOSL2/std.scad>` resolve it.
 *  cleanSpawnEnv spreads process.env, so this reaches every spawned child. */
function configureOpenscadPath(): void {
  const libDir = join(getSkillsBase(), "openscad", "lib");
  process.env["OPENSCADPATH"] = [libDir, process.env["OPENSCADPATH"]]
    .filter(Boolean)
    .join(delimiter);
}

app.whenReady().then(() => {
  installSecurityPolicy();
  registerStudioProtocol();
  configureOpenscadPath();
  initDb();
  createWindow();
  getMainWindow()?.loadURL(getRendererUrl());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      getMainWindow()?.loadURL(getRendererUrl());
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
