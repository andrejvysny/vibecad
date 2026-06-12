import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../electron/src/main/agents/claude-code";

describe("claudeCodeAdapter.parseEvent", () => {
  it("maps result → done", () => {
    const e = claudeCodeAdapter.parseEvent('{"type":"result","x":1}');
    expect(e.type).toBe("done");
  });

  it("maps assistant → text_delta", () => {
    const e = claudeCodeAdapter.parseEvent('{"type":"assistant"}');
    expect(e.type).toBe("text_delta");
  });

  it("passes tool_use / tool_result through", () => {
    expect(claudeCodeAdapter.parseEvent('{"type":"tool_use"}').type).toBe(
      "tool_use",
    );
    expect(claudeCodeAdapter.parseEvent('{"type":"tool_result"}').type).toBe(
      "tool_result",
    );
  });

  it("falls back to raw for non-JSON", () => {
    const e = claudeCodeAdapter.parseEvent("not json");
    expect(e.type).toBe("raw");
    expect(e.payload).toBe("not json");
  });
});
