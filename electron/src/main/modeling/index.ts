import type { BackendId, DetectedBackend } from "../../../../shared/types.js";
import { openscadBackend } from "./openscad.js";
import { build123dBackend } from "./build123d.js";
import type { ModelingBackend } from "../../../../shared/types.js";

const backends: ModelingBackend[] = [openscadBackend, build123dBackend];

export async function detectBackends(): Promise<DetectedBackend[]> {
  return Promise.all(
    backends.map(async (backend) => {
      const status = await backend.detect();
      return {
        id: backend.id,
        name: backend.name,
        detail: status.detail,
        available: status.available,
        exports: backend.exports,
        missing: status.missing,
      };
    }),
  );
}

export function getBackend(id: BackendId): ModelingBackend | undefined {
  return backends.find((b) => b.id === id);
}
