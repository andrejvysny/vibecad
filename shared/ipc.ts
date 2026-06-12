import type {
  AgentEvent,
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
