// Pure file-grouping logic for the workspace tree (extracted so it's unit-
// testable without importing the React component). A project's flat file list
// (root entries + `parts/<f>` subpaths) is bucketed into the assembly entry,
// individual parts, and legacy `model_NNN` artifacts.

export const SOURCE_EXTS = new Set([".scad", ".py"]);
export const PREVIEW_EXTS = new Set([".png"]);
export const EXPORT_EXTS = new Set([".stl", ".3mf", ".step", ".dxf"]);
// Formats the 3D viewer can load directly; others just reveal in the OS.
export const DISPLAYABLE = new Set([".stl", ".step"]);

export function ext(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i);
}

export function basename(filename: string): string {
  const e = ext(filename);
  return e ? filename.slice(0, -e.length) : filename;
}

// Group key: an artifact's path minus extension, with a trailing render-angle
// (`_front`/`_top`/`_iso`) stripped for PNGs. So `parts/lid.py`, `parts/lid.step`
// and `parts/lid_iso.png` all share `parts/lid`; `assembly.*` → `assembly`.
export function groupKey(f: string): string {
  const e = ext(f);
  let stem = e ? f.slice(0, -e.length) : f;
  if (e === ".png") stem = stem.replace(/_(front|top|iso)$/, "");
  return stem;
}

export function modelNum(key: string): number {
  return Number(/^model_(\d+)$/.exec(key)?.[1] ?? -1);
}

export type GroupKind = "assembly" | "part" | "legacy";

export interface Group {
  key: string;
  kind: GroupKind;
  source?: string;
  exports: string[];
  previews: string[];
}

export function kindOf(key: string): GroupKind {
  if (key === "assembly") return "assembly";
  if (key.startsWith("parts/")) return "part";
  return "legacy";
}

export function buildGroups(files: string[]): Group[] {
  const map = new Map<string, Group>();
  const get = (k: string): Group => {
    let g = map.get(k);
    if (!g) {
      g = { key: k, kind: kindOf(k), exports: [], previews: [] };
      map.set(k, g);
    }
    return g;
  };
  for (const f of files) {
    const e = ext(f);
    if (!SOURCE_EXTS.has(e) && !EXPORT_EXTS.has(e) && !PREVIEW_EXTS.has(e)) {
      continue; // skip dirs (parts, .studio) and unknown files
    }
    const g = get(groupKey(f));
    if (SOURCE_EXTS.has(e)) g.source = f;
    else if (EXPORT_EXTS.has(e)) g.exports.push(f);
    else if (PREVIEW_EXTS.has(e)) g.previews.push(f);
  }
  // Drop empty buckets (e.g. a key that matched nothing useful).
  return [...map.values()].filter(
    (g) => g.source || g.exports.length || g.previews.length,
  );
}

// `parts/lid_iso.png` → `iso` (the render angle), else the bare filename.
export function previewLabel(file: string, key: string): string {
  const m = new RegExp(`^${key}_(\\w+)\\.png$`).exec(file);
  return m ? m[1]! : file.slice(file.lastIndexOf("/") + 1);
}
