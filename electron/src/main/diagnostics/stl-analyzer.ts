import type { ModelDiagnostics } from "../../../../shared/types.js";

// Vertex-merge grid (mm). Coordinates within this distance collapse to one
// vertex so shared edges/shells are detected despite float reconstruction.
const GRID = 1e-6;

export class StlParseError extends Error {
  override readonly name = "StlParseError";
}

type Vec3 = [number, number, number];
type Tri = [Vec3, Vec3, Vec3];

/**
 * Dependency-free geometry diagnostics from an STL buffer (binary or ASCII).
 * Both backends always produce an STL, so this covers them uniformly. Pure: a
 * Buffer in, a {@link ModelDiagnostics} out (or a typed error on garbage).
 */
export function analyzeStl(buffer: Buffer): ModelDiagnostics {
  const tris = parse(buffer);
  return tris.length === 0 ? empty() : analyze(tris);
}

function empty(): ModelDiagnostics {
  return {
    source: "stl",
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    volumeMm3: 0,
    triangles: 0,
    shells: 0,
    watertight: false,
    valid: null,
    nonManifoldEdges: 0,
  };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Binary STL layout: 80B header + u32 count + 50B/tri. Returns count if it fits. */
function binaryTriCount(buf: Buffer): number | null {
  if (buf.length < 84) return null;
  const count = buf.readUInt32LE(80);
  return buf.length === 84 + count * 50 ? count : null;
}

function parse(buf: Buffer): Tri[] {
  const count = binaryTriCount(buf);
  if (count !== null) return parseBinary(buf, count);
  const text = buf.toString("utf8");
  if (/^\s*solid/.test(text) && /facet/.test(text)) return parseAscii(text);
  throw new StlParseError("Not a recognizable binary or ASCII STL buffer.");
}

function parseBinary(buf: Buffer, count: number): Tri[] {
  const tris: Tri[] = [];
  let o = 84; // skip header (80) + count (4)
  for (let t = 0; t < count; t++) {
    o += 12; // skip the per-facet normal (3 × float32)
    const tri: Vec3[] = [];
    for (let v = 0; v < 3; v++) {
      tri.push([
        buf.readFloatLE(o),
        buf.readFloatLE(o + 4),
        buf.readFloatLE(o + 8),
      ]);
      o += 12;
    }
    o += 2; // attribute byte count
    tris.push(tri as Tri);
  }
  return tris;
}

function parseAscii(text: string): Tri[] {
  const re = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
  const verts: Vec3[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    verts.push([
      Number.parseFloat(m[1] ?? "0"),
      Number.parseFloat(m[2] ?? "0"),
      Number.parseFloat(m[3] ?? "0"),
    ]);
  }
  // A well-formed ASCII STL has vertices in complete triples; a leftover means a
  // truncated facet. Reject it (the binary path is strict too) so the gate
  // degrades to "skipped" rather than silently analyzing a partial mesh.
  if (verts.length % 3 !== 0) {
    throw new StlParseError(
      `ASCII STL has ${verts.length} vertices (not a multiple of 3) — truncated facet`,
    );
  }
  const tris: Tri[] = [];
  for (let i = 0; i + 2 < verts.length; i += 3) {
    tris.push([verts[i]!, verts[i + 1]!, verts[i + 2]!]);
  }
  return tris;
}

// ── Analysis ─────────────────────────────────────────────────────────────────

function analyze(tris: Tri[]): ModelDiagnostics {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let volume6 = 0; // 6× signed volume (sum of v0·(v1×v2))
  const ids = new Map<string, number>();
  const parent: number[] = [];
  // undirected edge key → [count, directionSum]
  const edges = new Map<string, [number, number]>();

  const vid = (v: Vec3): number => {
    if (v[0] < min[0]) min[0] = v[0];
    if (v[1] < min[1]) min[1] = v[1];
    if (v[2] < min[2]) min[2] = v[2];
    if (v[0] > max[0]) max[0] = v[0];
    if (v[1] > max[1]) max[1] = v[1];
    if (v[2] > max[2]) max[2] = v[2];
    const key = `${Math.round(v[0] / GRID)},${Math.round(v[1] / GRID)},${Math.round(v[2] / GRID)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = parent.length;
      ids.set(key, id);
      parent.push(id);
    }
    return id;
  };

  for (const [a, b, c] of tris) {
    volume6 += a[0] * (b[1] * c[2] - b[2] * c[1]);
    volume6 += a[1] * (b[2] * c[0] - b[0] * c[2]);
    volume6 += a[2] * (b[0] * c[1] - b[1] * c[0]);
    const i = vid(a);
    const j = vid(b);
    const k = vid(c);
    union(parent, i, j);
    union(parent, j, k);
    addEdge(edges, i, j);
    addEdge(edges, j, k);
    addEdge(edges, k, i);
  }

  let nonManifold = 0;
  for (const [count, dir] of edges.values()) {
    // A closed manifold uses each edge exactly twice in opposite directions.
    if (count !== 2 || dir !== 0) nonManifold++;
  }

  return {
    source: "stl",
    bbox: { min, max },
    volumeMm3: Math.abs(volume6) / 6,
    triangles: tris.length,
    shells: countRoots(parent),
    watertight: nonManifold === 0,
    valid: null,
    nonManifoldEdges: nonManifold,
  };
}

function addEdge(
  edges: Map<string, [number, number]>,
  i: number,
  j: number,
): void {
  if (i === j) return; // degenerate
  const key = i < j ? `${i}_${j}` : `${j}_${i}`;
  const cur = edges.get(key) ?? [0, 0];
  cur[0] += 1;
  cur[1] += i < j ? 1 : -1;
  edges.set(key, cur);
}

function find(parent: number[], x: number): number {
  let r = x;
  while (parent[r] !== r) r = parent[r]!;
  while (parent[x] !== r) {
    const next = parent[x]!;
    parent[x] = r;
    x = next;
  }
  return r;
}

function union(parent: number[], a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[rb] = ra;
}

function countRoots(parent: number[]): number {
  let roots = 0;
  for (let i = 0; i < parent.length; i++) if (find(parent, i) === i) roots++;
  return roots;
}
