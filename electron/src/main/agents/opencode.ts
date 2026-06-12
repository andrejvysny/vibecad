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

export const openCodeAdapter: AgentAdapter = {
  id: "opencode",
  name: "OpenCode",

  detect: () => which("opencode"),

  spawn(opts: SpawnOpts) {
    // Skill content is prepended to the prompt as system context
    const promptWithSkill = opts.prompt;

    const args = ["run", "--format", "json", "--agent", "build"];
    if (opts.model) args.push("--model", opts.model); // expects provider/model
    args.push(promptWithSkill);
    const child = spawn("opencode", args, {
      cwd: opts.workingDir,
      env: cleanSpawnEnv(opts.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return child;
  },

  parseEvent(line: string): AgentEvent[] {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = obj["type"] as string;
      if (type === "message" || type === "text") {
        const text =
          (obj["text"] as string | undefined) ??
          (obj["content"] as string | undefined) ??
          "";
        return [{ type: "text_delta", payload: { text } }];
      }
      if (type === "done" || type === "complete")
        return [{ type: "done", payload: {} }];
      return [{ type: "raw", payload: obj }];
    } catch {
      return [{ type: "raw", payload: line }];
    }
  },

  kill(child) {
    child.kill("SIGTERM");
  },
};
