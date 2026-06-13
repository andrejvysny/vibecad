import { z } from "zod";
import type { ModelDiagnostics } from "../../../../shared/types.js";

// Shape of `render_harness.py --diagnostics` JSON. Malformed output → null so
// the diagnostics gate degrades to "skipped" instead of crashing the loop.
const BrepSchema = z.object({
  valid: z.boolean(),
  volume: z.number(),
  bbox: z.object({
    min: z.tuple([z.number(), z.number(), z.number()]),
    max: z.tuple([z.number(), z.number(), z.number()]),
  }),
  solids: z.number(),
  shells: z.number(),
});

/** Parse the harness B-rep JSON into ModelDiagnostics, or null when malformed. */
export function parseBrepDiagnostics(stdout: string): ModelDiagnostics | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  const parsed = BrepSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    source: "brep",
    bbox: d.bbox,
    volumeMm3: d.volume,
    shells: d.shells,
    watertight: null,
    valid: d.valid,
  };
}
