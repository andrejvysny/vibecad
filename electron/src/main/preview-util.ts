// Pure preview helpers (no Electron/DB imports, so they're unit-testable).

/** A mesh needs (re)building when it's absent or older than its source. */
export function isMeshStale(
  sourceMtimeMs: number,
  meshMtimeMs: number | null,
): boolean {
  return meshMtimeMs === null || meshMtimeMs < sourceMtimeMs;
}
