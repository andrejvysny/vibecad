import type {
  AgentEvent,
  AgentId,
  BackendId,
  CameraPreset,
  DetectedAgent,
  DetectedBackend,
  ExportFormat,
  GateId,
  Workflow,
  WorkflowRunStatus,
} from "./types";

// Renderer → Main (ipcRenderer.invoke / ipcMain.handle)
export type RunAgentPayload = {
  prompt: string;
  projectId: string;
  sessionId?: string;
  // Absolute paths to image files (already saved into the project) to reference.
  attachments?: string[];
  // Composer "Verify" toggle (Phase 3): force a vision-in-the-loop pass.
  verify?: boolean;
  // Manual feedback the user drew on the 3D model this turn (pins / region).
  // Coords are in model space (mm). The annotated screenshot rides in `attachments`.
  selection?: SelectionFeedback;
  // Multi-part edit scope: project-relative part source paths the agent should
  // restrict edits to (e.g. ["parts/lid.py"]). Empty/undefined ⇒ whole model.
  editScope?: string[];
};
// User-placed pins and an optional region-of-interest box, captured from the
// 3D viewer. Injected into the agent preamble as a "Manual feedback" section.
export type SelectionFeedback = {
  points: { n: number; x: number; y: number; z: number; note: string }[];
  region?: { min: [number, number, number]; max: [number, number, number] };
};
export type ChatHistoryPayload = { projectId: string };
// `kind` distinguishes a user's own message ("chat") from app-injected
// auto-repair / vision turns so the renderer can collapse the latter.
export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  eventsJson?: string;
  kind?: "chat" | "repair" | "vision";
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
// Pick an external STEP file and copy it into the project; returns the new
// project-relative filename.
export type ImportStepPayload = { projectId: string };
// Delete a single multi-part source file (`parts/<name>.{py,scad}`) from a
// project. `part` is the project-relative path. Returns the deleted path.
export type DeletePartPayload = { projectId: string; part: string };

// Serializable project row sent across IPC (no Date fields).
export type ProjectRecord = {
  id: string;
  name: string;
  dir: string;
  agentId: AgentId;
  // Selected CLI model for the bound agent; null ⇒ the agent's own default.
  agentModel: string | null;
  modelingBackend: BackendId;
  outputNeed: "print" | "cad";
  // Epoch ms — lets the renderer sort the switcher newest-first.
  createdAt: number;
};
export type CreateProjectPayload = {
  name: string;
  agentId: AgentId;
  modelingBackend: BackendId;
  outputNeed: "print" | "cad";
};
export type GetProjectPayload = { id: string };
export type ReadInstructionsPayload = { projectId: string };
export type WriteInstructionsPayload = { projectId: string; content: string };
// Custom skills + references live as files under <project>/.studio. import/add
// open a native picker in main and return the updated entry-name list.
export type ListSkillsPayload = { projectId: string };
export type ImportSkillPayload = { projectId: string };
export type RemoveSkillPayload = { projectId: string; name: string };
export type ListReferencesPayload = { projectId: string };
export type AddReferencePayload = { projectId: string };
export type RemoveReferencePayload = { projectId: string; name: string };
export type RenameProjectPayload = { id: string; name: string };
export type SetProjectAgentPayload = { id: string; agentId: AgentId };
// `model` is the CLI model string ("" ⇒ clear back to the agent default).
export type SetProjectModelPayload = { id: string; model: string };
export type DeleteProjectPayload = { id: string };

// Workflows (saved recipes under .studio/workflows). run() executes steps as
// sequential agent turns; fromStep resumes a paused run.
export type ListWorkflowsPayload = { projectId: string };
export type SaveWorkflowPayload = { projectId: string; workflow: Workflow };
export type DeleteWorkflowPayload = { projectId: string; slug: string };
export type RunWorkflowPayload = {
  projectId: string;
  slug: string;
  fromStep?: number;
};

// Main → Renderer (webContents.send / ipcRenderer.on)
// `meshPath` is the artifact the viewer should render (`.step` for build123d,
// `.stl` for openscad).
export type PreviewMeshReadyPayload = { projectId: string; meshPath: string };
export type PreviewUpdatedPayload = {
  projectId: string;
  angle: CameraPreset;
  pngPath: string;
};
export type PreviewErrorPayload = { projectId: string; message: string };
export type WorkspaceChangedPayload = { projectId: string; files: string[] };
// Live progress of the post-turn accuracy pipeline (validate → repair → vision).
// Drives the renderer status chip; "ok"/"failed" are terminal.
export type TurnPhase =
  | "validating"
  | "rendering"
  | "repairing"
  | "escalating"
  | "vision"
  | "ok"
  | "failed";
export type TurnStatusPayload = {
  projectId: string;
  phase: TurnPhase;
  attempt?: number;
  maxAttempts?: number;
  gate?: GateId;
  message?: string;
};
// Per-step progress for a running workflow. `index` is the step the event is
// about; `nextStep` accompanies a "paused" status (where to resume).
export type WorkflowStepPayload = {
  projectId: string;
  slug: string;
  index: number;
  total: number;
  title: string;
  status: WorkflowRunStatus;
  nextStep?: number;
  message?: string;
};
export type AgentsDetectedPayload = { agents: DetectedAgent[] };
export type BackendsDetectedPayload = { backends: DetectedBackend[] };

export type { AgentEvent };
