import type { CameraPreset } from "@shared/types";

const CAMERAS: CameraPreset[] = ["front", "top", "iso"];

/**
 * From a project's file list, find the highest-versioned `model_NNN` source and
 * map its rendered `model_NNN_<cam>.png` files to absolute preview paths.
 * Padding-agnostic: reuses the source file's exact basename.
 */
export function deriveLatestPreviews(
  files: string[],
  dir: string,
): Partial<Record<CameraPreset, string>> {
  let bestNum = -1;
  let bestBase = "";
  for (const f of files) {
    const m = /^(model_(\d+))\.(?:scad|py)$/.exec(f);
    if (m && Number(m[2]) > bestNum) {
      bestNum = Number(m[2]);
      bestBase = m[1]!;
    }
  }
  if (bestNum < 0) return {};

  const previews: Partial<Record<CameraPreset, string>> = {};
  for (const cam of CAMERAS) {
    const png = `${bestBase}_${cam}.png`;
    if (files.includes(png)) previews[cam] = `${dir}/${png}`;
  }
  return previews;
}
