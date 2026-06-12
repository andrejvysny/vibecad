import type { BackendId } from "./types";

/** Map a project's output need to its modeling backend (spec §7). */
export function pickBackend(need: "print" | "cad"): BackendId {
  return need === "cad" ? "build123d" : "openscad";
}
