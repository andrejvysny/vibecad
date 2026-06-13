import type { ChildProcess } from "node:child_process";

export type ExportFormat = "stl" | "3mf" | "step" | "dxf";
export type CameraPreset = "front" | "top" | "iso";
export type BackendId = "openscad" | "build123d";
export type AgentId = "claude-code" | "opencode" | "codex";
export type OutputNeed = "print" | "cad";

export interface SpawnOpts {
  prompt: string;
  workingDir: string;
  // Extra dirs the agent is granted read access to (e.g. the bundled skill dir,
  // which lives outside the project cwd). Empty for agents that can't add dirs.
  contextDirs: string[];
  // Assembled project context (instructions + skills + references + attachments).
  // Injected as a system prompt where supported, else prepended to the prompt.
  systemPreamble: string;
  sessionId?: string;
  env?: Record<string, string>;
  // CLI model override, passed verbatim to the agent's `--model` flag. Empty/
  // undefined ⇒ no flag, i.e. the CLI's own configured default.
  model?: string;
}

// Per-agent model presets surfaced in the model picker. The empty `value` is
// "Default" → no `--model` flag. Values are passed verbatim to each CLI, so
// they follow that CLI's own naming (aliases for claude, `provider/model` for
// opencode). The user can always fall back to Default if their setup differs.
export const AGENT_MODELS: Record<
  AgentId,
  ReadonlyArray<{ value: string; label: string }>
> = {
  "claude-code": [
    { value: "", label: "Default" },
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ],
  codex: [
    { value: "", label: "Default" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5", label: "GPT-5" },
    { value: "o3", label: "o3" },
  ],
  opencode: [
    { value: "", label: "Default" },
    { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "anthropic/claude-opus-4-1", label: "Claude Opus 4.1" },
    { value: "openai/gpt-5", label: "GPT-5" },
  ],
};

// Normalized event vocabulary the renderer understands, regardless of which
// agent CLI produced it. Adapters translate native stream formats into these.
export type AgentEvent =
  | { type: "session"; payload: { sessionId: string } }
  | { type: "text_delta"; payload: { text: string } }
  | { type: "tool_use"; payload: { id: string; name: string; input: unknown } }
  | {
      type: "tool_result";
      payload: { toolUseId: string; content: unknown; isError: boolean };
    }
  | {
      type: "done";
      payload: { sessionId?: string; isError?: boolean; result?: string };
    }
  | { type: "error"; payload: { message: string } }
  | { type: "raw"; payload: unknown };

export interface AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  detect(): Promise<string | null>;
  spawn(opts: SpawnOpts): ChildProcess;
  // A single stdout line can carry multiple content blocks → multiple events.
  parseEvent(line: string): AgentEvent[];
  kill(child: ChildProcess): void;
}

export interface RenderRequest {
  modelPath: string;
  outDir: string;
  cameras: CameraPreset[];
  size: [number, number];
}

export interface BackendStatus {
  available: boolean;
  detail: string;
  missing?: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export type ParamType =
  | "number"
  | "integer"
  | "boolean"
  | "string"
  | "array"
  | "expression";

export interface Param {
  name: string;
  value: number | string | boolean;
  line: number;
  type?: ParamType;
  // Customizer constraints parsed from the trailing `// [..]` comment.
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description?: string;
  unit?: string;
  // Group heading from a `// === Section ===` / `# === Section ===` comment.
  section?: string;
}

export interface ModelingBackend {
  readonly id: BackendId;
  readonly name: string;
  readonly sourceExt: ".scad" | ".py";
  readonly exports: ExportFormat[];
  readonly skillId: string;
  detect(): Promise<BackendStatus>;
  render(req: RenderRequest): Promise<string[]>;
  export(modelPath: string, format: ExportFormat): Promise<string>;
  // Like export() but also surfaces the tool's stderr — CGAL/mesh warnings that
  // exit 0 and would otherwise be lost. The diagnostics gate reads it (OpenSCAD).
  exportWithLog?(
    modelPath: string,
    format: ExportFormat,
  ): Promise<{ path: string; stderr: string }>;
  validate(modelPath: string): Promise<ValidationResult>;
  extractParams(source: string): Promise<Param[]>;
  // B-rep diagnostics from the modeling kernel (build123d → OCCT BRepCheck).
  // Absent ⇒ the gate relies on the mesh analyzer alone (OpenSCAD).
  brepDiagnostics?(modelPath: string): Promise<ModelDiagnostics | null>;
}

// A saved, re-runnable recipe: an ordered list of prompts the agent executes as
// sequential turns. Stored as <project>/.studio/workflows/<slug>.json.
export interface WorkflowStep {
  title: string;
  prompt: string;
  // Default true. When false, the run pauses AFTER this step until the user
  // resumes (renderer re-invokes workflow:run with the next step index).
  autoAdvance?: boolean;
}

export interface Workflow {
  // Filename stem; assigned by main on save (derived from name when absent).
  slug: string;
  name: string;
  description?: string;
  // "planned" is reserved for future agent-decomposed workflows.
  kind: "recipe" | "planned";
  steps: WorkflowStep[];
}

export type WorkflowRunStatus =
  | "running"
  | "done"
  | "paused"
  | "finished"
  | "error";

export interface DetectedAgent {
  id: AgentId;
  name: string;
  path: string;
  available: boolean;
}

export interface DetectedBackend {
  id: BackendId;
  name: string;
  detail: string;
  available: boolean;
  exports: ExportFormat[];
  missing?: string[];
}

// ──── Accuracy stack: gates, diagnostics, repair policy (Phase 1+) ─────────────

export type GateId = "validate" | "export" | "diagnostics" | "vision";
export type GateStatus = "pass" | "warn" | "fail" | "skipped";

export interface GateResult {
  gate: GateId;
  status: GateStatus;
  errors: string[]; // hard failures → drive repair
  warnings: string[]; // soft context → appended to prompts, never block
  durationMs: number;
}

export interface ModelDiagnostics {
  source: "stl" | "brep";
  bbox: { min: [number, number, number]; max: [number, number, number] };
  volumeMm3: number | null;
  triangles?: number;
  shells: number; // connected components (STL) / shell count (B-rep)
  watertight: boolean | null;
  valid: boolean | null; // BRepCheck validity (build123d only)
  nonManifoldEdges?: number;
}

export interface TurnVerdict {
  modelPath: string | null; // null ⇒ Q&A turn, skip pipeline entirely
  results: GateResult[];
  diagnostics?: ModelDiagnostics;
  meshPath?: string; // export-gate artifact, reused for preview:mesh-ready
  ok: boolean; // every non-skipped gate ≠ "fail"
  envFailure: boolean; // binary missing etc. — never burn agent tokens on this
}

export type RepairAction =
  | { kind: "accept" }
  | { kind: "repair"; attempt: number }
  | { kind: "escalate"; model: string }
  | { kind: "give-up" };

// L6 — no schema change; mirrors AGENT_MODELS presets.
export const ESCALATION_MODELS: Record<AgentId, string> = {
  "claude-code": "opus",
  codex: "gpt-5.5",
  opencode: "anthropic/claude-opus-4-1",
};

// L5 — codex is text-only, no image ingestion.
export const AGENT_SUPPORTS_VISION: Record<AgentId, boolean> = {
  "claude-code": true,
  opencode: true,
  codex: false,
};
