import type { ChildProcess } from "node:child_process";

export type ExportFormat = "stl" | "3mf" | "step" | "dxf";
export type CameraPreset = "front" | "top" | "iso";
export type BackendId = "openscad" | "build123d";
export type AgentId = "claude-code" | "opencode" | "codex";

export interface SpawnOpts {
  prompt: string;
  workingDir: string;
  skillsDir: string;
  sessionId?: string;
  env?: Record<string, string>;
}

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
  validate(modelPath: string): Promise<ValidationResult>;
  extractParams(source: string): Promise<Param[]>;
}

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
