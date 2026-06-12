/**
 * From a project's file list, return the highest-versioned `model_NNN` source
 * basename (e.g. "model_003"), or null if none exist. Padding-agnostic.
 */
export function latestModelBase(files: string[]): string | null {
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
