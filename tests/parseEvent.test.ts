import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../electron/src/main/agents/claude-code";

const parse = (line: string) => claudeCodeAdapter.parseEvent(line);

describe("claudeCodeAdapter.parseEvent", () => {
  it("captures the session id from system init", () => {
    const [e] = parse('{"type":"system","subtype":"init","session_id":"s1"}');
    expect(e).toEqual({ type: "session", payload: { sessionId: "s1" } });
  });

  it("streams text from partial content_block_delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hi" },
      },
    });
    expect(parse(line)).toEqual([
      { type: "text_delta", payload: { text: "hi" } },
    ]);
  });

  it("extracts tool_use blocks from an assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "writing" },
          {
            type: "tool_use",
            id: "t1",
            name: "Write",
            input: { file_path: "a.scad" },
          },
        ],
      },
    });
    expect(parse(line)).toEqual([
      {
        type: "tool_use",
        payload: { id: "t1", name: "Write", input: { file_path: "a.scad" } },
      },
    ]);
  });

  it("extracts tool_result blocks from a user message", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "ok",
            is_error: false,
          },
        ],
      },
    });
    expect(parse(line)).toEqual([
      {
        type: "tool_result",
        payload: { toolUseId: "t1", content: "ok", isError: false },
      },
    ]);
  });

  it("maps result → done with session id", () => {
    const [e] = parse(
      '{"type":"result","session_id":"s1","is_error":false,"result":"done"}',
    );
    expect(e).toEqual({
      type: "done",
      payload: { sessionId: "s1", isError: false, result: "done" },
    });
  });

  it("falls back to raw for non-JSON", () => {
    expect(parse("not json")).toEqual([{ type: "raw", payload: "not json" }]);
  });
});
