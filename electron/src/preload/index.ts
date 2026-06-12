import "electron-log/preload";
import { contextBridge, ipcRenderer } from "electron";
import type {
  RunAgentPayload,
  StopAgentPayload,
  ExportModelPayload,
  OpenModelPayload,
  RenderModelPayload,
  CreateProjectPayload,
  GetProjectPayload,
  ProjectRecord,
  PreviewUpdatedPayload,
  WorkspaceChangedPayload,
} from "../../../shared/ipc.js";
import type {
  AgentEvent,
  DetectedAgent,
  DetectedBackend,
} from "../../../shared/types.js";

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) =>
    cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("api", {
  // Agent
  detectAgents: (): Promise<DetectedAgent[]> =>
    ipcRenderer.invoke("agent:detect"),
  runAgent: (payload: RunAgentPayload): Promise<void> =>
    ipcRenderer.invoke("agent:run", payload),
  stopAgent: (payload: StopAgentPayload): Promise<void> =>
    ipcRenderer.invoke("agent:stop", payload),

  // Modeling backend
  detectBackends: (): Promise<DetectedBackend[]> =>
    ipcRenderer.invoke("backend:detect"),
  exportModel: (payload: ExportModelPayload): Promise<string> =>
    ipcRenderer.invoke("model:export", payload),
  openModel: (payload: OpenModelPayload): Promise<void> =>
    ipcRenderer.invoke("model:open", payload),
  renderModel: (payload: RenderModelPayload): Promise<string[]> =>
    ipcRenderer.invoke("model:render", payload),

  // Project
  createProject: (payload: CreateProjectPayload): Promise<ProjectRecord> =>
    ipcRenderer.invoke("project:create", payload),
  listProjects: (): Promise<ProjectRecord[]> =>
    ipcRenderer.invoke("project:list"),
  openProject: (payload: GetProjectPayload): Promise<ProjectRecord> =>
    ipcRenderer.invoke("project:open", payload),

  // Push events from main
  onAgentEvent: (cb: (event: AgentEvent) => void) =>
    on<AgentEvent>("agent:event", cb),
  onPreviewUpdated: (cb: (payload: PreviewUpdatedPayload) => void) =>
    on<PreviewUpdatedPayload>("preview:updated", cb),
  onWorkspaceChanged: (cb: (payload: WorkspaceChangedPayload) => void) =>
    on<WorkspaceChangedPayload>("workspace:changed", cb),

  // App
  getVersions: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("app:get-versions"),
  setOverlayTheme: (theme: {
    color: string;
    symbolColor: string;
  }): Promise<void> => ipcRenderer.invoke("window:set-overlay-theme", theme),
});
