// Minimal ambient typing for the occt-import-js emscripten module.
// Upstream ships no types; we declare only the surface we use (ReadStepFile).
declare module "occt-import-js" {
  export interface OcctMesh {
    name?: string;
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  }
  export interface OcctReadResult {
    success: boolean;
    meshes: OcctMesh[];
  }
  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params: unknown): OcctReadResult;
  }
  export interface OcctFactoryOptions {
    locateFile?: (path: string, prefix: string) => string;
  }
  export default function occtimportjs(
    options?: OcctFactoryOptions,
  ): Promise<OcctModule>;
}
