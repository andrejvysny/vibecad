import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  name: "Claude Code",

  detect: () => which("claude"),

  spawn(opts: SpawnOpts) {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--allowedTools",
      "Bash,Read,Write,Edit",
      "--add-dir",
      opts.skillsDir,
    ];
    if (opts.sessionId) args.push("--resume", opts.sessionId);

    const child = spawn("claude", args, {
      cwd: opts.workingDir,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin?.write(opts.prompt);
    child.stdin?.end();
    return child;
  },

  parseEvent(line: string): AgentEvent {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = obj["type"] as string;
      if (type === "result") return { type: "done", payload: obj };
      if (type === "assistant") return { type: "text_delta", payload: obj };
      if (type === "tool_use") return { type: "tool_use", payload: obj };
      if (type === "tool_result") return { type: "tool_result", payload: obj };
      return { type: "raw", payload: obj };
    } catch {
      return { type: "raw", payload: line };
    }
  },

  kill(child) {
    child.kill("SIGTERM");
  },
};
