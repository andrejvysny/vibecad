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
  // Absolute paths to image files (already saved into the project) to reference.
  attachments?: string[];
};
export type ChatHistoryPayload = { projectId: string };
export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  eventsJson?: string;
};
export type PickImagesPayload = { projectId: string };
export type SaveAttachmentPayload = {
  projectId: string;
  name: string;
  dataBase64: string;
};
export type StopAgentPayload = { projectId: string };
export type ExportModelPayload = { modelPath: string; format: ExportFormat };
// Parameter panel: read the active model's customizable params, and patch one.
export type ExtractParamsPayload = { projectId: string; modelPath?: string };
export type SetParamPayload = {
  projectId: string;
  modelPath?: string;
  name: string;
  value: number | string | boolean;
};
// `ok:false` ⇒ the patch broke validate() and was reverted; `errors` say why.
export type SetParamResult = { ok: boolean; errors: string[] };
// Export the preview STL for a model (latest model if modelPath omitted).
export type PreviewMeshPayload = { projectId: string; modelPath?: string };
export type ReadModelPayload = { path: string };
export type RevealPayload = { path: string };

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
export type PreviewMeshReadyPayload = { projectId: string; stlPath: string };
export type PreviewUpdatedPayload = {
  projectId: string;
  angle: CameraPreset;
  pngPath: string;
};
export type PreviewErrorPayload = { projectId: string; message: string };
export type WorkspaceChangedPayload = { projectId: string; files: string[] };
export type AgentsDetectedPayload = { agents: DetectedAgent[] };
export type BackendsDetectedPayload = { backends: DetectedBackend[] };

export type { AgentEvent };
