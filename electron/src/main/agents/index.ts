import type {
  AgentAdapter,
  AgentId,
  DetectedAgent,
} from "../../../../shared/types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { openCodeAdapter } from "./opencode.js";
import { codexAdapter } from "./codex.js";
import type { ChildProcess } from "node:child_process";

const adapters: AgentAdapter[] = [
  claudeCodeAdapter,
  openCodeAdapter,
  codexAdapter,
];

const activeProcesses = new Map<
  string,
  { child: ChildProcess; adapterId: AgentId }
>();

export async function detectAgents(): Promise<DetectedAgent[]> {
  return Promise.all(
    adapters.map(async (adapter) => {
      const path = await adapter.detect();
      return {
        id: adapter.id,
        name: adapter.name,
        path: path ?? "",
        available: path !== null,
      };
    }),
  );
}

export function getAdapter(id: AgentId): AgentAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

export function registerActive(
  projectId: string,
  adapterId: AgentId,
  child: ChildProcess,
): void {
  activeProcesses.set(projectId, { child, adapterId });
  child.on("close", () => activeProcesses.delete(projectId));
}

export function killActive(projectId: string): void {
  const active = activeProcesses.get(projectId);
  if (!active) return;
  const adapter = getAdapter(active.adapterId);
  adapter ? adapter.kill(active.child) : active.child.kill("SIGTERM");
  activeProcesses.delete(projectId);
}
