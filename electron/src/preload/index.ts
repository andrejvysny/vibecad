import "electron-log/preload";
import { contextBridge, ipcRenderer } from "electron";
import type {
  RunAgentPayload,
  StopAgentPayload,
  ExportModelPayload,
  ExtractParamsPayload,
  SetParamPayload,
  SetParamResult,
  PreviewMeshPayload,
  ReadModelPayload,
  RevealPayload,
  ImportStepPayload,
  DeletePartPayload,
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
  WorkflowStepPayload,
  DeleteProjectPayload,
  RenameProjectPayload,
  SetProjectAgentPayload,
  SetProjectModelPayload,
  ProjectRecord,
  PreviewUpdatedPayload,
  PreviewErrorPayload,
  PreviewMeshReadyPayload,
  WorkspaceChangedPayload,
  TurnStatusPayload,
  ChatHistoryPayload,
  ChatMessageRecord,
  PickImagesPayload,
  SaveAttachmentPayload,
} from "../../../shared/ipc.js";
import type {
  AgentEvent,
  DetectedAgent,
  DetectedBackend,
  Param,
  Workflow,
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
  chatHistory: (payload: ChatHistoryPayload): Promise<ChatMessageRecord[]> =>
    ipcRenderer.invoke("chat:history", payload),
  pickImages: (payload: PickImagesPayload): Promise<string[]> =>
    ipcRenderer.invoke("chat:pick-images", payload),
  saveAttachment: (payload: SaveAttachmentPayload): Promise<string> =>
    ipcRenderer.invoke("chat:save-attachment", payload),

  // Modeling backend
  detectBackends: (): Promise<DetectedBackend[]> =>
    ipcRenderer.invoke("backend:detect"),
  exportModel: (payload: ExportModelPayload): Promise<string> =>
    ipcRenderer.invoke("model:export", payload),
  extractParams: (payload: ExtractParamsPayload): Promise<Param[]> =>
    ipcRenderer.invoke("model:extract-params", payload),
  setParam: (payload: SetParamPayload): Promise<SetParamResult> =>
    ipcRenderer.invoke("model:set-param", payload),
  previewMesh: (payload: PreviewMeshPayload): Promise<string> =>
    ipcRenderer.invoke("model:preview-mesh", payload),
  readModel: (payload: ReadModelPayload): Promise<string> =>
    ipcRenderer.invoke("model:read", payload),
  importStep: (payload: ImportStepPayload): Promise<string | null> =>
    ipcRenderer.invoke("model:import-step", payload),
  deletePart: (payload: DeletePartPayload): Promise<string> =>
    ipcRenderer.invoke("project:delete-part", payload),
  revealItem: (payload: RevealPayload): Promise<void> =>
    ipcRenderer.invoke("shell:reveal", payload),

  // Project
  createProject: (payload: CreateProjectPayload): Promise<ProjectRecord> =>
    ipcRenderer.invoke("project:create", payload),
  listProjects: (): Promise<ProjectRecord[]> =>
    ipcRenderer.invoke("project:list"),
  openProject: (payload: GetProjectPayload): Promise<ProjectRecord> =>
    ipcRenderer.invoke("project:open", payload),
  renameProject: (payload: RenameProjectPayload): Promise<ProjectRecord> =>
    ipcRenderer.invoke("project:rename", payload),
  readInstructions: (payload: ReadInstructionsPayload): Promise<string> =>
    ipcRenderer.invoke("project:read-instructions", payload),
  writeInstructions: (payload: WriteInstructionsPayload): Promise<void> =>
    ipcRenderer.invoke("project:write-instructions", payload),
  listSkills: (payload: ListSkillsPayload): Promise<string[]> =>
    ipcRenderer.invoke("project:list-skills", payload),
  importSkill: (payload: ImportSkillPayload): Promise<string[]> =>
    ipcRenderer.invoke("project:import-skill", payload),
  removeSkill: (payload: RemoveSkillPayload): Promise<string[]> =>
    ipcRenderer.invoke("project:remove-skill", payload),
  listReferences: (payload: ListReferencesPayload): Promise<string[]> =>
    ipcRenderer.invoke("project:list-references", payload),
  addReference: (payload: AddReferencePayload): Promise<string[]> =>
    ipcRenderer.invoke("project:add-reference", payload),
  removeReference: (payload: RemoveReferencePayload): Promise<string[]> =>
    ipcRenderer.invoke("project:remove-reference", payload),

  // Workflows
  listWorkflows: (payload: ListWorkflowsPayload): Promise<Workflow[]> =>
    ipcRenderer.invoke("workflow:list", payload),
  saveWorkflow: (payload: SaveWorkflowPayload): Promise<Workflow[]> =>
    ipcRenderer.invoke("workflow:save", payload),
  deleteWorkflow: (payload: DeleteWorkflowPayload): Promise<Workflow[]> =>
    ipcRenderer.invoke("workflow:delete", payload),
  runWorkflow: (payload: RunWorkflowPayload): Promise<void> =>
    ipcRenderer.invoke("workflow:run", payload),
  setProjectAgent: (payload: SetProjectAgentPayload): Promise<ProjectRecord> =>
    ipcRenderer.invoke("project:set-agent", payload),
  setProjectModel: (payload: SetProjectModelPayload): Promise<ProjectRecord> =>
    ipcRenderer.invoke("project:set-model", payload),
  deleteProject: (payload: DeleteProjectPayload): Promise<{ id: string }> =>
    ipcRenderer.invoke("project:delete", payload),

  // Push events from main
  onAgentEvent: (cb: (event: AgentEvent) => void) =>
    on<AgentEvent>("agent:event", cb),
  onPreviewUpdated: (cb: (payload: PreviewUpdatedPayload) => void) =>
    on<PreviewUpdatedPayload>("preview:updated", cb),
  onPreviewError: (cb: (payload: PreviewErrorPayload) => void) =>
    on<PreviewErrorPayload>("preview:error", cb),
  onPreviewMeshReady: (cb: (payload: PreviewMeshReadyPayload) => void) =>
    on<PreviewMeshReadyPayload>("preview:mesh-ready", cb),
  onWorkspaceChanged: (cb: (payload: WorkspaceChangedPayload) => void) =>
    on<WorkspaceChangedPayload>("workspace:changed", cb),
  onTurnStatus: (cb: (payload: TurnStatusPayload) => void) =>
    on<TurnStatusPayload>("turn:status", cb),
  onWorkflowStep: (cb: (payload: WorkflowStepPayload) => void) =>
    on<WorkflowStepPayload>("workflow:step", cb),

  // App
  getVersions: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("app:get-versions"),
  setOverlayTheme: (theme: {
    color: string;
    symbolColor: string;
  }): Promise<void> => ipcRenderer.invoke("window:set-overlay-theme", theme),
});
