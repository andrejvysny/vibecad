import * as THREE from "three";
import ocFactory from "opencascade.js/dist/opencascade.full.js";
// `?url` yields the hashed asset URL in dev and prod; the emscripten glue
// fetches the ~50 MB .wasm from there via locateFile.
import wasmUrl from "opencascade.js/dist/opencascade.full.wasm?url";
import type {
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
} from "opencascade.js";

// opencascade.js's generated enum types model neither the runtime `.value`
// field nor the member→container relation, so these bridge them without `any`.
function enumValue(e: unknown): number {
  return (e as { value: number }).value;
}
function asShapeEnum(member: unknown): TopAbs_ShapeEnum {
  return member as TopAbs_ShapeEnum;
}

// The upstream default export is typed `() => Promise<...>` but is actually the
// emscripten module factory invoked with `new Module(opts)`.
type OcModuleFactory = new (mod: {
  locateFile: (path: string) => string;
}) => Promise<OpenCascadeInstance>;

// Full OCCT wasm is huge — init once, reuse for every STEP load.
let ocPromise: Promise<OpenCascadeInstance> | null = null;
function occt(): Promise<OpenCascadeInstance> {
  ocPromise ??= new (ocFactory as unknown as OcModuleFactory)({
    locateFile: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
  });
  return ocPromise;
}

export interface StepResult {
  geometry: THREE.BufferGeometry;
  // True B-rep edge curves as line-segment positions (pairs of points), or null
  // if edge extraction failed — the viewer then falls back to EdgesGeometry.
  edges: Float32Array | null;
}

/** Read a STEP file into a single shape via OCCT's STEP reader. */
function readShape(oc: OpenCascadeInstance, buf: ArrayBuffer): TopoDS_Shape {
  const path = "/model.step";
  oc.FS.writeFile(path, new Uint8Array(buf));
  const reader = new oc.STEPControl_Reader_1();
  const status = reader.ReadFile(path);
  // IFSelect_RetDone === successful read.
  if (
    enumValue(status) !== enumValue(oc.IFSelect_ReturnStatus.IFSelect_RetDone)
  ) {
    reader.delete();
    oc.FS.unlink(path);
    throw new Error("STEP read failed");
  }
  reader.TransferRoots(new oc.Message_ProgressRange_1());
  const shape = reader.OneShape();
  reader.delete();
  oc.FS.unlink(path);
  if (shape.IsNull()) throw new Error("STEP contained no shape");
  return shape;
}

/** Tessellate every face of the shape into merged position + index arrays. */
function tessellateFaces(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  // BRep_Tool.Triangulation's 3rd arg is a Poly_MeshPurpose enum that opencascade.js
  // does not bind; OCCT accepts 0 (== Poly_MeshPurpose_NONE) at runtime.
  const NONE = 0 as unknown as Parameters<typeof oc.BRep_Tool.Triangulation>[2];
  const ex = new oc.TopExp_Explorer_2(
    shape,
    asShapeEnum(oc.TopAbs_ShapeEnum.TopAbs_FACE),
    asShapeEnum(oc.TopAbs_ShapeEnum.TopAbs_SHAPE),
  );
  for (; ex.More(); ex.Next()) {
    const face = oc.TopoDS.Face_1(ex.Current());
    const loc = new oc.TopLoc_Location_1();
    const handle = oc.BRep_Tool.Triangulation(face, loc, NONE);
    if (handle.IsNull()) {
      loc.delete();
      face.delete();
      continue;
    }
    const tri = handle.get();
    const ident = loc.IsIdentity();
    const trsf = loc.Transformation();
    const nbNodes = tri.NbNodes();
    for (let i = 1; i <= nbNodes; i++) {
      const node = tri.Node(i);
      const p = ident ? node : node.Transformed(trsf);
      positions.push(p.X(), p.Y(), p.Z());
      if (p !== node) p.delete();
      node.delete();
    }
    // Reversed faces store CW triangles — flip to keep outward-facing winding.
    const reversed =
      enumValue(face.Orientation_1()) ===
      enumValue(oc.TopAbs_Orientation.TopAbs_REVERSED);
    const nbTri = tri.NbTriangles();
    for (let i = 1; i <= nbTri; i++) {
      const t = tri.Triangle(i);
      const a = t.Value(1);
      const b = t.Value(2);
      const c = t.Value(3);
      if (reversed)
        indices.push(offset + a - 1, offset + c - 1, offset + b - 1);
      else indices.push(offset + a - 1, offset + b - 1, offset + c - 1);
      t.delete();
    }
    offset += nbNodes;
    trsf.delete();
    loc.delete();
    face.delete();
  }
  ex.delete();
  if (positions.length === 0) throw new Error("STEP tessellation was empty");
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/** Discretize every B-rep edge into line segments (true CAD wireframe). */
function extractEdges(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  deflection: number,
): Float32Array {
  const segs: number[] = [];
  const ex = new oc.TopExp_Explorer_2(
    shape,
    asShapeEnum(oc.TopAbs_ShapeEnum.TopAbs_EDGE),
    asShapeEnum(oc.TopAbs_ShapeEnum.TopAbs_SHAPE),
  );
  for (; ex.More(); ex.Next()) {
    const edge = oc.TopoDS.Edge_1(ex.Current());
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const gc = new oc.GCPnts_UniformDeflection_2(curve, deflection, true);
    if (gc.IsDone()) {
      const n = gc.NbPoints();
      for (let i = 1; i < n; i++) {
        const p1 = gc.Value(i);
        const p2 = gc.Value(i + 1);
        segs.push(p1.X(), p1.Y(), p1.Z(), p2.X(), p2.Y(), p2.Z());
        p1.delete();
        p2.delete();
      }
    }
    gc.delete();
    curve.delete();
    edge.delete();
  }
  ex.delete();
  return new Float32Array(segs);
}

/** Bounding-box diagonal of a shape (for relative tessellation deflection). */
function boundingDiagonal(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
): number {
  const box = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape, box, false);
  const diag = box.IsVoid() ? 0 : Math.sqrt(box.SquareExtent());
  box.delete();
  return diag;
}

/**
 * Parse a STEP file (B-rep) into a tessellated three.js geometry plus true
 * CAD edge curves, entirely client-side via the full OpenCascade WASM kernel.
 */
export async function loadStepGeometry(buf: ArrayBuffer): Promise<StepResult> {
  const oc = await occt();
  const shape = readShape(oc, buf);
  try {
    const diag = boundingDiagonal(oc, shape) || 1;
    const linDeflection = diag * 0.001;
    const angDeflection = 0.3;
    new oc.BRepMesh_IncrementalMesh_2(
      shape,
      linDeflection,
      false,
      angDeflection,
      false,
    );

    const { positions, indices } = tessellateFaces(oc, shape);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    let edges: Float32Array | null = null;
    try {
      edges = extractEdges(oc, shape, linDeflection);
    } catch {
      edges = null; // fall back to three.js EdgesGeometry in the viewer
    }
    return { geometry, edges };
  } finally {
    shape.delete();
  }
}
