// Bridges the annotation overlay (which owns the viewer + drawn marks, inside the
// Preview panel) to the chat composer (a sibling panel) so Send can grab a
// composited annotated screenshot. The overlay registers its capture fn on mount.

type CaptureFn = () => Promise<string | null>;

let capture: CaptureFn | null = null;

export function registerAnnotationCapture(fn: CaptureFn | null): void {
  capture = fn;
}

/** Returns the annotated screenshot as base64 (no data: prefix), or null. */
export function captureAnnotation(): Promise<string | null> {
  return capture ? capture() : Promise.resolve(null);
}
