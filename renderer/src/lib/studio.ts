/** Build a studio:// URL the renderer can fetch / use as an <img> src. */
export function studioUrl(absPath: string): string {
  return `studio://local/${encodeURIComponent(absPath)}`;
}
