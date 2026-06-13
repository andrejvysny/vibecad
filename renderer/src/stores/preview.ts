/**
 * The default preview target key for a project's files. Multi-part projects use
 * a stable `assembly` entry (preferred when present); legacy projects fall back
 * to the highest-versioned `model_NNN` source basename. null when neither
 * exists. Padding-agnostic. The returned key is used to derive sibling paths
 * (`<key>.stl`, `<key>_iso.png`, …) so it may include a `parts/` prefix.
 */
export function latestModelBase(files: string[]): string | null {
  if (files.some((f) => /^assembly\.(?:scad|py)$/.test(f))) return "assembly";
  let bestNum = -1;
  let best: string | null = null;
  for (const f of files) {
    const m = /^(model_(\d+))\.(?:scad|py)$/.exec(f);
    if (m && Number(m[2]) > bestNum) {
      bestNum = Number(m[2]);
      best = m[1]!;
    }
  }
  return best;
}
