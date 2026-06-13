import type {
  ModelDiagnostics,
  OutputNeed,
  RepairAction,
  TurnVerdict,
} from "../../../../shared/types.js";

// Error strings that indicate a missing/broken toolchain rather than a model
// mistake. Repairing these would only burn agent tokens — give up immediately.
const ENV_FAILURE_RE =
  /(not found|not available|no python|ENOENT|command not found|cannot find|is not recognized|no such file)/i;

export function isEnvFailure(errors: string[]): boolean {
  return errors.some((e) => ENV_FAILURE_RE.test(e));
}

export interface DecideOpts {
  maxRepairs: number;
  escalationModel: string;
  // The model the just-run turn used (project default unless already escalated).
  currentModel?: string;
}

/**
 * Decide what to do after a turn's gate verdict. `attempt` is the count of
 * repair/escalate turns already executed (0 right after the user's chat turn).
 * Order: accept clean → never spend tokens on env failures → up to `maxRepairs`
 * same-model repairs → one escalation to the stronger model → give up.
 */
export function decideNextAction(
  verdict: TurnVerdict,
  attempt: number,
  opts: DecideOpts,
): RepairAction {
  if (verdict.ok) return { kind: "accept" };
  if (verdict.envFailure) return { kind: "give-up" };
  if (attempt < opts.maxRepairs)
    return { kind: "repair", attempt: attempt + 1 };
  // Repairs exhausted — escalate once, but only if we aren't already on the
  // strong model (the project may have started on it).
  if (opts.currentModel !== opts.escalationModel) {
    return { kind: "escalate", model: opts.escalationModel };
  }
  return { kind: "give-up" };
}

const MAX_DIM_MM = 1000;

/**
 * Map deterministic geometry diagnostics onto repair-driving errors vs prompt
 * context warnings, per the Phase-2 severity table. `print` (OpenSCAD) demands a
 * watertight, manifold solid; `cad` (build123d) leans on B-rep validity.
 */
export function classifyDiagnostics(
  diag: ModelDiagnostics,
  outputNeed: OutputNeed,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Empty / degenerate geometry — always hard.
  if (diag.triangles === 0) errors.push("Exported mesh has 0 triangles.");
  if (diag.volumeMm3 !== null && diag.volumeMm3 <= 0) {
    errors.push(`Model volume is non-positive (${diag.volumeMm3} mm³).`);
  }
  const dims = axisLengths(diag.bbox);
  if (dims.some((d) => d <= 0)) {
    errors.push("Bounding box is degenerate (a dimension is 0).");
  }

  // B-rep validity (build123d) — hard.
  if (diag.valid === false) {
    errors.push("B-rep check reports the solid is invalid.");
  }

  // Watertightness — hard for printing, irrelevant for CAD-only B-rep output.
  if (diag.watertight === false && outputNeed === "print") {
    errors.push("Mesh is not watertight (open edges) — not printable.");
  }

  // Non-manifold edges — hard for print, soft for cad.
  if (diag.nonManifoldEdges && diag.nonManifoldEdges > 0) {
    const msg = `${diag.nonManifoldEdges} non-manifold edge(s).`;
    if (outputNeed === "print") errors.push(msg);
    else warnings.push(msg);
  }

  // Multiple shells — could be intentional (multi-part); warn only.
  if (diag.shells > 1) {
    warnings.push(`Model has ${diag.shells} disconnected shells.`);
  }

  // Oversized model — probable unit error; warn only.
  if (dims.some((d) => d > MAX_DIM_MM)) {
    warnings.push(
      `Largest dimension exceeds ${MAX_DIM_MM} mm — check units (mm vs m).`,
    );
  }

  return { errors, warnings };
}

function axisLengths(bbox: ModelDiagnostics["bbox"]): [number, number, number] {
  return [
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ];
}
