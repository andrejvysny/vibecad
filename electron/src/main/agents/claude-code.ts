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

// Subset of Claude stream-json content-block shapes we read.
interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

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
    if (opts.model) args.push("--model", opts.model);
    if (opts.sessionId) args.push("--resume", opts.sessionId);

    const child = spawn("claude", args, {
      cwd: opts.workingDir,
      env: cleanSpawnEnv(opts.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin?.write(opts.prompt);
    child.stdin?.end();
    return child;
  },

  parseEvent(line: string): AgentEvent[] {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return [{ type: "raw", payload: line }];
    }
    const type = obj["type"] as string;

    // session bootstrap → capture the resumable session id
    if (type === "system" && obj["subtype"] === "init") {
      const sessionId = obj["session_id"] as string | undefined;
      return sessionId ? [{ type: "session", payload: { sessionId } }] : [];
    }

    // partial message chunks → live text streaming
    if (type === "stream_event") {
      const ev = obj["event"] as Record<string, unknown> | undefined;
      if (ev?.["type"] === "content_block_delta") {
        const delta = ev["delta"] as Record<string, unknown> | undefined;
        if (delta?.["type"] === "text_delta") {
          return [
            { type: "text_delta", payload: { text: String(delta["text"]) } },
          ];
        }
      }
      return [];
    }

    // final assistant message → emit tool_use blocks (text already streamed)
    if (type === "assistant") {
      const message = obj["message"] as Record<string, unknown> | undefined;
      const content = (message?.["content"] as ContentBlock[]) ?? [];
      return content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          type: "tool_use" as const,
          payload: {
            id: String(b.id ?? ""),
            name: String(b.name ?? "tool"),
            input: b.input ?? {},
          },
        }));
    }

    // tool results arrive as a synthetic user message
    if (type === "user") {
      const message = obj["message"] as Record<string, unknown> | undefined;
      const content = (message?.["content"] as ContentBlock[]) ?? [];
      return content
        .filter((b) => b.type === "tool_result")
        .map((b) => ({
          type: "tool_result" as const,
          payload: {
            toolUseId: String(b.tool_use_id ?? ""),
            content: b.content ?? "",
            isError: b.is_error === true,
          },
        }));
    }

    if (type === "result") {
      return [
        {
          type: "done",
          payload: {
            sessionId: obj["session_id"] as string | undefined,
            isError: obj["is_error"] === true,
            result: obj["result"] as string | undefined,
          },
        },
      ];
    }

    return [{ type: "raw", payload: obj }];
  },

  kill(child) {
    child.kill("SIGTERM");
  },
};
