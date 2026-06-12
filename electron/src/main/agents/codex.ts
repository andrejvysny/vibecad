import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanSpawnEnv } from "../spawn-env.js";
import type {
  AgentAdapter,
  AgentEvent,
  SpawnOpts,
} from "../../../../shared/types.js";

const execFileAsync = promisify(execFile);

async function which(bin: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(cmd, [bin]);
    return stdout.trim().split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "Codex CLI",

  detect: () => which("codex"),

  spawn(opts: SpawnOpts) {
    // Codex has no structured output — plain text stream
    const args = ["--approval-mode", "auto-edit", "--quiet"];
    if (opts.model) args.push("--model", opts.model);
    args.push(opts.prompt); // positional prompt must come last
    const child = spawn("codex", args, {
      cwd: opts.workingDir,
      env: cleanSpawnEnv(opts.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return child;
  },

  parseEvent(line: string): AgentEvent[] {
    // Codex emits plain text; wrap each line as a text delta (keep newline).
    return [{ type: "text_delta", payload: { text: `${line}\n` } }];
  },

  kill(child) {
    child.kill("SIGTERM");
  },
};
