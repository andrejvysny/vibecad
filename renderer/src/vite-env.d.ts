/// <reference types="vite/client" />

import type {
  AgentEvent,
  AgentId,
  BackendId,
  DetectedAgent,
  DetectedBackend,
  ExportFormat,
  CameraPreset,
} from "@shared/types";

interface ProjectRecord {
  id: string;
  name: string;
  dir: string;
  agentId: AgentId;
  modelingBackend: BackendId;
  outputNeed: "print" | "cad";
}

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
  renderModel(payload: {
    projectId: string;
    backendId: BackendId;
    modelPath: string;
    outDir: string;
  }): Promise<string[]>;
  // Project
  createProject(payload: {
    name: string;
    agentId: AgentId;
    modelingBackend: BackendId;
    outputNeed: "print" | "cad";
  }): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  openProject(payload: { id: string }): Promise<ProjectRecord>;
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
