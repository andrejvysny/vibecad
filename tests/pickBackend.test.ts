import { describe, expect, it } from "vitest";
import { pickBackend } from "../shared/backend-select";

describe("pickBackend", () => {
  it("maps cad → build123d", () => {
    expect(pickBackend("cad")).toBe("build123d");
  });
  it("maps print → openscad", () => {
    expect(pickBackend("print")).toBe("openscad");
  });
});
