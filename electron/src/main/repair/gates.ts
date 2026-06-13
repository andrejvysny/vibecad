import { readFile } from "node:fs/promises";
import { produceMesh } from "../preview.js";
import { analyzeStl } from "../diagnostics/stl-analyzer.js";
import { parseOpenscadStderr } from "../diagnostics/openscad-stderr.js";
import { classifyDiagnostics, isEnvFailure } from "./policy.js";
import type {
  GateResult,
  GateStatus,
  ModelDiagnostics,
  ModelingBackend,
  OutputNeed,
  TurnVerdict,
} from "../../../../shared/types.js";

/** Run an async gate body, stamping its wall-clock duration onto the result. */
async function gate(
  build: () => Promise<Omit<GateResult, "durationMs">>,
): Promise<GateResult> {
  const start = Date.now();
  const result = await build();
  return { ...result, durationMs: Date.now() - start };
}

function buildVerdict(
  modelPath: string,
  results: GateResult[],
  meshPath: string | undefined,
  diagnostics: ModelDiagnostics | undefined,
): TurnVerdict {
  const ok = results.every((r) => r.status !== "fail");
  const failErrors = results
    .filter((r) => r.status === "fail")
    .flatMap((r) => r.errors);
  return {
    modelPath,
    results,
    meshPath,
    diagnostics,
    ok,
    envFailure: isEnvFailure(failErrors),
  };
}

/**
 * The deterministic, token-free gate chain run after every model-producing turn:
 * Gate 1 validate (parse/eval — also surfaces a missing toolchain), Gate 2 export
 * (produces the preview mesh the loop reuses for `preview:mesh-ready`), Gate 3
 * diagnostics (mesh + B-rep geometry checks, per the severity table).
 */
export async function runGateChain(
  backend: ModelingBackend,
  modelPath: string,
  outputNeed: OutputNeed,
): Promise<TurnVerdict> {
  const results: GateResult[] = [];

  const validate = await gate(async () => {
    const res = await backend.validate(modelPath);
    return {
      gate: "validate" as const,
      status: res.ok ? ("pass" as const) : ("fail" as const),
      errors: res.ok ? [] : res.errors,
      warnings: [],
    };
  });
  results.push(validate);
  if (validate.status === "fail") {
    return buildVerdict(modelPath, results, undefined, undefined);
  }

  let meshPath: string | undefined;
  let exportStderr = "";
  const exportGate = await gate(async () => {
    try {
      const r = await produceMesh(backend, modelPath);
      meshPath = r.meshPath;
      exportStderr = r.stderr;
      return {
        gate: "export" as const,
        status: "pass" as const,
        errors: [],
        warnings: [],
      };
    } catch (err) {
      return {
        gate: "export" as const,
        status: "fail" as const,
        errors: [err instanceof Error ? err.message : String(err)],
        warnings: [],
      };
    }
  });
  results.push(exportGate);
  if (exportGate.status === "fail") {
    return buildVerdict(modelPath, results, meshPath, undefined);
  }

  let diagnostics: ModelDiagnostics | undefined;
  const diagGate = await gate(async () => {
    const d = await diagnose(backend, modelPath, exportStderr, outputNeed);
    diagnostics = d.diagnostics;
    return {
      gate: "diagnostics" as const,
      status: d.status,
      errors: d.errors,
      warnings: d.warnings,
    };
  });
  results.push(diagGate);

  return buildVerdict(modelPath, results, meshPath, diagnostics);
}

interface DiagResult {
  status: GateStatus;
  errors: string[];
  warnings: string[];
  diagnostics?: ModelDiagnostics;
}

/**
 * Combine mesh analysis (both backends always write an STL), B-rep checks
 * (build123d), and parsed export stderr (OpenSCAD) into one diagnostics verdict.
 * Any missing source degrades gracefully — never crashes the loop.
 */
async function diagnose(
  backend: ModelingBackend,
  modelPath: string,
  exportStderr: string,
  outputNeed: OutputNeed,
): Promise<DiagResult> {
  const stlPath = modelPath.replace(/\.(scad|py)$/, ".stl");
  let diag: ModelDiagnostics | null = null;
  try {
    diag = analyzeStl(await readFile(stlPath));
  } catch {
    diag = null;
  }
  if (backend.brepDiagnostics) {
    const brep = await backend.brepDiagnostics(modelPath).catch(() => null);
    if (brep) diag = mergeBrep(diag, brep);
  }

  const extra =
    backend.id === "openscad"
      ? parseOpenscadStderr(exportStderr)
      : { errors: [], warnings: [] };

  if (!diag) {
    return extra.errors.length
      ? { status: "fail", errors: extra.errors, warnings: extra.warnings }
      : { status: "skipped", errors: [], warnings: extra.warnings };
  }

  const cls = classifyDiagnostics(diag, outputNeed);
  const errors = [...cls.errors, ...extra.errors];
  const warnings = [...cls.warnings, ...extra.warnings];
  const status: GateStatus = errors.length
    ? "fail"
    : warnings.length
      ? "warn"
      : "pass";
  return { status, errors, warnings, diagnostics: diag };
}

/** Prefer B-rep for validity/volume/bbox/shells; keep mesh-only watertightness. */
function mergeBrep(
  stl: ModelDiagnostics | null,
  brep: ModelDiagnostics,
): ModelDiagnostics {
  if (!stl) return brep;
  return {
    ...stl,
    source: "brep",
    valid: brep.valid,
    volumeMm3: brep.volumeMm3 ?? stl.volumeMm3,
    bbox: brep.bbox,
    shells: brep.shells,
  };
}
