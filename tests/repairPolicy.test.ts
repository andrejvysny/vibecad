import { describe, expect, it } from "vitest";
import {
  decideNextAction,
  isEnvFailure,
} from "../electron/src/main/repair/policy";
import type { TurnVerdict } from "../shared/types";

const verdict = (o: Partial<TurnVerdict> = {}): TurnVerdict => ({
  modelPath: "/p/model_001.scad",
  results: [],
  ok: false,
  envFailure: false,
  ...o,
});

const opts = (o: Partial<Parameters<typeof decideNextAction>[2]> = {}) => ({
  maxRepairs: 2,
  escalationModel: "opus",
  currentModel: undefined,
  ...o,
});

describe("decideNextAction", () => {
  it("accepts a clean verdict", () => {
    expect(decideNextAction(verdict({ ok: true }), 0, opts())).toEqual({
      kind: "accept",
    });
  });

  it("warnings-only (ok:true) is accepted, not repaired", () => {
    const v = verdict({
      ok: true,
      results: [
        {
          gate: "diagnostics",
          status: "warn",
          errors: [],
          warnings: ["2 shells"],
          durationMs: 1,
        },
      ],
    });
    expect(decideNextAction(v, 0, opts())).toEqual({ kind: "accept" });
  });

  it("first failure → repair attempt 1", () => {
    expect(decideNextAction(verdict(), 0, opts())).toEqual({
      kind: "repair",
      attempt: 1,
    });
  });

  it("repairs exhausted → escalate with the mapped model", () => {
    expect(decideNextAction(verdict(), 2, opts())).toEqual({
      kind: "escalate",
      model: "opus",
    });
  });

  it("failure after escalation → give up", () => {
    expect(
      decideNextAction(verdict(), 3, opts({ currentModel: "opus" })),
    ).toEqual({ kind: "give-up" });
  });

  it("env failure gives up immediately (no tokens)", () => {
    expect(decideNextAction(verdict({ envFailure: true }), 0, opts())).toEqual({
      kind: "give-up",
    });
  });

  it("skips escalation when already on the strong model", () => {
    expect(
      decideNextAction(verdict(), 2, opts({ currentModel: "opus" })),
    ).toEqual({ kind: "give-up" });
  });
});

describe("isEnvFailure", () => {
  it("flags missing-toolchain messages", () => {
    expect(isEnvFailure(["OpenSCAD not found"])).toBe(true);
    expect(isEnvFailure(["build123d not available"])).toBe(true);
    expect(isEnvFailure(["spawn f3d ENOENT"])).toBe(true);
  });

  it("does not flag ordinary model errors", () => {
    expect(isEnvFailure(["ERROR: Parser error in line 3"])).toBe(false);
    expect(isEnvFailure([])).toBe(false);
  });
});
