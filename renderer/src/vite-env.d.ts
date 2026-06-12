/// <reference types="vite/client" />

import type {
  AgentEvent,
  DetectedAgent,
  DetectedBackend,
  ExportFormat,
  CameraPreset,
} from "@shared/types";

interface ElectronAPI {
  // Agent
  detectAgents(): Promise<DetectedAgent[]>;
  runAgent(payload: {
    prompt: string;
    projectId: string;
    sessionId?: string;
  }): Promise<void>;
  stopAgent(payload: { projectId: string }): Promise<void>;
  // Modeling
  detectBackends(): Promise<DetectedBackend[]>;
  exportModel(payload: {
    modelPath: string;
    format: ExportFormat;
  }): Promise<string>;
  openModel(payload: { modelPath: string }): Promise<void>;
  // Push events (return unsubscribe fn)
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
  onPreviewUpdated(
    cb: (p: {
      projectId: string;
      angle: CameraPreset;
      pngPath: string;
    }) => void,
  ): () => void;
  onWorkspaceChanged(
    cb: (p: { projectId: string; files: string[] }) => void,
  ): () => void;
  // App
  getVersions(): Promise<Record<string, string>>;
  setOverlayTheme(theme: { color: string; symbolColor: string }): Promise<void>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
