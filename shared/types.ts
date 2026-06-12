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

export interface AgentEvent {
  type: "text_delta" | "tool_use" | "tool_result" | "done" | "error" | "raw";
  payload: unknown;
}

export interface AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  detect(): Promise<string | null>;
  spawn(opts: SpawnOpts): ChildProcess;
  parseEvent(line: string): AgentEvent;
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

export interface Param {
  name: string;
  value: number;
  unit?: string;
  line: number;
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
