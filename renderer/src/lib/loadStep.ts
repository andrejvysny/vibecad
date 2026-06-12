import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import occtimportjs from "occt-import-js";
// `?url` yields the hashed asset URL in dev and prod; the emscripten glue
// fetches the .wasm from there via locateFile.
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

// The WASM module is ~7.5 MB; init once and reuse for every STEP load.
let occtPromise: ReturnType<typeof occtimportjs> | null = null;
function occt(): ReturnType<typeof occtimportjs> {
  occtPromise ??= occtimportjs({ locateFile: () => wasmUrl });
  return occtPromise;
}

/** Tessellate a STEP file (B-rep) into a single THREE geometry via OpenCascade. */
export async function loadStepGeometry(
  buf: ArrayBuffer,
): Promise<THREE.BufferGeometry> {
  const occtModule = await occt();
  const result = occtModule.ReadStepFile(new Uint8Array(buf), null);
  if (!result.success || result.meshes.length === 0) {
    throw new Error("STEP parse produced no geometry");
  }

  const geometries = result.meshes.map((mesh) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3),
    );
    if (mesh.attributes.normal) {
      geo.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3),
      );
    }
    geo.setIndex(mesh.index.array);
    // Normalize attributes so all solids merge cleanly into one geometry.
    if (!mesh.attributes.normal) geo.computeVertexNormals();
    return geo;
  });

  if (geometries.length === 1) return geometries[0]!;
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  if (!merged) throw new Error("Failed to merge STEP solids");
  return merged;
}
