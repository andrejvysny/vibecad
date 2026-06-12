/// <reference types="vite/client" />

import type {
  AgentEvent,
  AgentId,
  BackendId,
  DetectedAgent,
  DetectedBackend,
  ExportFormat,
  Param,
  Workflow,
  WorkflowRunStatus,
} from "@shared/types";

interface WorkflowStepPayload {
  projectId: string;
  slug: string;
  index: number;
  total: number;
  title: string;
  status: WorkflowRunStatus;
  nextStep?: number;
  message?: string;
}

interface SetParamResult {
  ok: boolean;
  errors: string[];
}

interface ProjectRecord {
  id: string;
  name: string;
  dir: string;
  agentId: AgentId;
  agentModel: string | null;
  modelingBackend: BackendId;
  outputNeed: "print" | "cad";
  createdAt: number;
}

interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  eventsJson?: string;
}

interface ElectronAPI {
  // Agent
  detectAgents(): Promise<DetectedAgent[]>;
  runAgent(payload: {
    prompt: string;
    projectId: string;
    sessionId?: string;
    attachments?: string[];
  }): Promise<void>;
  stopAgent(payload: { projectId: string }): Promise<void>;
  chatHistory(payload: { projectId: string }): Promise<ChatMessageRecord[]>;
  pickImages(payload: { projectId: string }): Promise<string[]>;
  saveAttachment(payload: {
    projectId: string;
    name: string;
    dataBase64: string;
  }): Promise<string>;
  // Modeling
  detectBackends(): Promise<DetectedBackend[]>;
  exportModel(payload: {
    modelPath: string;
    format: ExportFormat;
  }): Promise<string>;
  extractParams(payload: {
    projectId: string;
    modelPath?: string;
  }): Promise<Param[]>;
  setParam(payload: {
    projectId: string;
    modelPath?: string;
    name: string;
    value: number | string | boolean;
  }): Promise<SetParamResult>;
  previewMesh(payload: {
    projectId: string;
    modelPath?: string;
  }): Promise<string>;
  readModel(payload: { path: string }): Promise<string>;
  revealItem(payload: { path: string }): Promise<void>;
  importStep(payload: { projectId: string }): Promise<string | null>;
  // Project
  createProject(payload: {
    name: string;
    agentId: AgentId;
    modelingBackend: BackendId;
    outputNeed: "print" | "cad";
  }): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  openProject(payload: { id: string }): Promise<ProjectRecord>;
  renameProject(payload: { id: string; name: string }): Promise<ProjectRecord>;
  readInstructions(payload: { projectId: string }): Promise<string>;
  writeInstructions(payload: {
    projectId: string;
    content: string;
  }): Promise<void>;
  listSkills(payload: { projectId: string }): Promise<string[]>;
  importSkill(payload: { projectId: string }): Promise<string[]>;
  removeSkill(payload: { projectId: string; name: string }): Promise<string[]>;
  listReferences(payload: { projectId: string }): Promise<string[]>;
  addReference(payload: { projectId: string }): Promise<string[]>;
  removeReference(payload: {
    projectId: string;
    name: string;
  }): Promise<string[]>;
  listWorkflows(payload: { projectId: string }): Promise<Workflow[]>;
  saveWorkflow(payload: {
    projectId: string;
    workflow: Workflow;
  }): Promise<Workflow[]>;
  deleteWorkflow(payload: {
    projectId: string;
    slug: string;
  }): Promise<Workflow[]>;
  runWorkflow(payload: {
    projectId: string;
    slug: string;
    fromStep?: number;
  }): Promise<void>;
  setProjectAgent(payload: {
    id: string;
    agentId: AgentId;
  }): Promise<ProjectRecord>;
  setProjectModel(payload: {
    id: string;
    model: string;
  }): Promise<ProjectRecord>;
  deleteProject(payload: { id: string }): Promise<{ id: string }>;
  // Push events (return unsubscribe fn)
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
  onPreviewMeshReady(
    cb: (p: { projectId: string; meshPath: string }) => void,
  ): () => void;
  onPreviewError(
    cb: (p: { projectId: string; message: string }) => void,
  ): () => void;
  onWorkspaceChanged(
    cb: (p: { projectId: string; files: string[] }) => void,
  ): () => void;
  onWorkflowStep(cb: (p: WorkflowStepPayload) => void): () => void;
  // App
  getVersions(): Promise<Record<string, string>>;
  setOverlayTheme(theme: { color: string; symbolColor: string }): Promise<void>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
