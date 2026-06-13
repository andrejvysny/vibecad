import { readdir } from "node:fs/promises";
import { join } from "node:path";
import log from "electron-log/main";
import { getBackend } from "./modeling/index.js";
import { getProject, type ProjectRow } from "./projects.js";
import { sendToRenderer } from "./window.js";
import type { CameraPreset, ModelingBackend } from "../../../shared/types.js";

/** The newest model_NNN source file in a project, or null. */
export async function latestModel(project: ProjectRow): Promise<string | null> {
  const ext = project.modelingBackend === "openscad" ? ".scad" : ".py";
  const latest = (await readdir(project.dir))
    .filter((f) => /^model_\d+/.test(f) && f.endsWith(ext))
    .sort()
    .at(-1);
  return latest ? join(project.dir, latest) : null;
}

/**
 * Export the preview mesh artifacts (no IPC). build123d renders the precise STEP
 * directly (returned as the preview) and also writes an STL as the always-present
 * print mesh; OpenSCAD uses STL. Returns the export's stderr too (CGAL/2-manifold
 * advisories the diagnostics gate parses). Headless (no GL → no render crash).
 */
export async function produceMesh(
  backend: ModelingBackend,
  modelPath: string,
): Promise<{ meshPath: string; stderr: string }> {
  if (backend.id === "build123d") {
    const meshPath = await backend.export(modelPath, "step");
    await backend.export(modelPath, "stl"); // print-ready mesh, always present
    return { meshPath, stderr: "" };
  }
  if (backend.exportWithLog) {
    const { path, stderr } = await backend.exportWithLog(modelPath, "stl");
    return { meshPath: path, stderr };
  }
  return { meshPath: await backend.export(modelPath, "stl"), stderr: "" };
}

/**
 * Export the preview mesh for a model and notify the renderer. Used by the
 * one-off IPC paths (`model:preview-mesh`, `model:set-param`); the agent-turn
 * loop produces the mesh via the export gate and emits `preview:mesh-ready` itself.
 */
export async function exportPreviewMesh(
  projectId: string,
  modelPath: string,
): Promise<string> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const backend = getBackend(project.modelingBackend);
  if (!backend)
    throw new Error(`Backend not available: ${project.modelingBackend}`);
  const status = await backend.detect();
  if (!status.available) {
    throw new Error(
      `${backend.name} not available${status.missing ? ` (missing: ${status.missing.join(", ")})` : ""}`,
    );
  }
  const { meshPath } = await produceMesh(backend, modelPath);
  sendToRenderer("preview:mesh-ready", { projectId, meshPath });
  return meshPath;
}

/**
 * Render snapshot PNGs of a model (for vision-in-the-loop). Best-effort: returns
 * the written paths and pushes `preview:updated` per angle for thumbnails; an
 * empty result (backend/f3d missing, render failure) means "no vision possible".
 */
export async function renderSnapshots(
  project: ProjectRow,
  modelPath: string,
  cameras: CameraPreset[],
): Promise<string[]> {
  const backend = getBackend(project.modelingBackend);
  if (!backend) return [];
  const status = await backend.detect();
  if (!status.available) return [];
  // build123d PNGs need f3d; it's reported in `missing` but doesn't gate the
  // backend (the WASM viewer covers in-app 3D). No f3d ⇒ no snapshots.
  if (backend.id === "build123d" && status.missing?.includes("f3d")) return [];
  try {
    const pngs = await backend.render({
      modelPath,
      outDir: project.dir,
      cameras,
      size: [800, 600],
    });
    pngs.forEach((pngPath, i) => {
      const angle = cameras[i];
      if (angle) {
        sendToRenderer("preview:updated", {
          projectId: project.id,
          angle,
          pngPath,
        });
      }
    });
    return pngs;
  } catch (err) {
    log.warn("[preview] snapshot render failed:", err);
    return [];
  }
}

/** Find the newest model in a project and export its preview mesh. */
export async function renderLatest(projectId: string): Promise<void> {
  try {
    const project = getProject(projectId);
    if (!project) return;
    const modelPath = await latestModel(project);
    if (!modelPath) return;
    await exportPreviewMesh(projectId, modelPath);
  } catch (err) {
    log.error("[preview] mesh export failed:", err);
    sendToRenderer("preview:error", {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
