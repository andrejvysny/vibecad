import * as THREE from "three";
import type {
  ViewportMaterialPreset,
  ViewportSettings,
} from "../../stores/viewport.store";

export interface ViewportBudget {
  dpr: number;
  ao: boolean;
  shadowMapSize: number;
  edgeThreshold: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function resolveViewportBudget(
  settings: ViewportSettings,
  viewport: { width: number; height: number },
  triangles: number,
): ViewportBudget {
  const area = viewport.width * viewport.height;
  let dpr =
    settings.quality === "performance"
      ? 1.5
      : settings.quality === "max"
        ? 3
        : 2.5;

  if (area > 2_400_000) dpr = Math.min(dpr, 2);
  else if (area > 1_500_000) dpr = Math.min(dpr, 2.25);

  if (triangles > 1_000_000) dpr = Math.min(dpr, 1.5);
  else if (triangles > 500_000) dpr = Math.min(dpr, 2);

  if (settings.quality === "performance") dpr = Math.min(dpr, 1.5);
  dpr = clamp(dpr, 1, 3);

  const targetPixels = area * dpr * dpr;
  const aoLimit = settings.quality === "max" ? 12_000_000 : 8_000_000;
  const triangleLimit = settings.quality === "max" ? 1_200_000 : 650_000;
  const ao =
    settings.aoEnabled &&
    settings.quality !== "performance" &&
    targetPixels <= aoLimit &&
    triangles <= triangleLimit;

  const shadowMapSize =
    settings.quality === "max" && targetPixels <= 14_000_000
      ? 4096
      : settings.quality === "performance"
        ? 1024
        : 2048;

  return {
    dpr,
    ao,
    shadowMapSize,
    edgeThreshold: settings.quality === "performance" ? 35 : 28,
  };
}

export function materialParams(
  preset: ViewportMaterialPreset,
): THREE.MeshStandardMaterialParameters {
  const shared = {
    metalness: 0.02,
    side: THREE.DoubleSide,
  };
  if (preset === "studio-gray") {
    return {
      ...shared,
      color: 0xb8c0c8,
      roughness: 0.58,
      envMapIntensity: 0.9,
    };
  }
  return {
    ...shared,
    color: 0x93b5df,
    roughness: 0.62,
    envMapIntensity: 0.95,
  };
}

export function edgeColor(preset: ViewportMaterialPreset): number {
  return preset === "studio-gray" ? 0x404956 : 0x263a58;
}
