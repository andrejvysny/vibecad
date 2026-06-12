import type {
  AgentEvent,
  AgentId,
  BackendId,
  CameraPreset,
  DetectedAgent,
  DetectedBackend,
  ExportFormat,
} from "./types";

// Renderer → Main (ipcRenderer.invoke / ipcMain.handle)
export type RunAgentPayload = {
  prompt: string;
  projectId: string;
  sessionId?: string;
};
export type StopAgentPayload = { projectId: string };
export type ExportModelPayload = { modelPath: string; format: ExportFormat };
export type OpenModelPayload = { modelPath: string };
export type RenderModelPayload = {
  projectId: string;
  backendId: BackendId;
  modelPath: string;
  outDir: string;
};

// Serializable project row sent across IPC (no Date fields).
export type ProjectRecord = {
  id: string;
  name: string;
  dir: string;
  agentId: AgentId;
  modelingBackend: BackendId;
  outputNeed: "print" | "cad";
};
export type CreateProjectPayload = {
  name: string;
  agentId: AgentId;
  modelingBackend: BackendId;
  outputNeed: "print" | "cad";
};
export type GetProjectPayload = { id: string };

// Main → Renderer (webContents.send / ipcRenderer.on)
export type PreviewUpdatedPayload = {
  projectId: string;
  angle: CameraPreset;
  pngPath: string;
};
export type WorkspaceChangedPayload = { projectId: string; files: string[] };
export type AgentsDetectedPayload = { agents: DetectedAgent[] };
export type BackendsDetectedPayload = { backends: DetectedBackend[] };

export type { AgentEvent };
