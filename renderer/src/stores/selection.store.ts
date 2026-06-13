import { create } from "zustand";

// Manual 3D feedback state: the user marks the current model with pins, a region
// box, and freehand strokes, which ride along with the next chat message as an
// annotated screenshot + structured coords. Ephemeral — never persisted.

export type AnnotTool = "orbit" | "pin" | "box" | "draw";

/** A pin anchored in MODEL space (mm) so it survives same-model re-renders. */
export interface Pin {
  id: string;
  n: number; // 1-based badge number, matches the screenshot + agent block
  world: [number, number, number];
  note: string;
}

/** Region box: the drawn screen rect (px, for the screenshot) plus an
 *  approximate model-space bounding box (null when no mesh was hit). */
export interface Box {
  screen: { x: number; y: number; w: number; h: number };
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
}

/** Freehand stroke, points normalized 0..1 over the canvas (pure overlay). */
export interface Stroke {
  pts: [number, number][];
}

interface SelectionStore {
  tool: AnnotTool;
  modelBase: string | null;
  pins: Pin[];
  box: Box | null;
  strokes: Stroke[];
  setTool(tool: AnnotTool): void;
  addPin(world: [number, number, number]): string;
  setPinNote(id: string, note: string): void;
  removePin(id: string): void;
  setBox(box: Box | null): void;
  addStroke(stroke: Stroke): void;
  clearAll(): void;
  /** Bind the active model; clears all marks when it changes. */
  bindModel(base: string | null): void;
  hasFeedback(): boolean;
}

const uid = (): string => crypto.randomUUID();

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  tool: "orbit",
  modelBase: null,
  pins: [],
  box: null,
  strokes: [],

  setTool: (tool) => set({ tool }),

  addPin: (world) => {
    const id = uid();
    set((s) => ({
      pins: [...s.pins, { id, n: s.pins.length + 1, world, note: "" }],
    }));
    return id;
  },

  setPinNote: (id, note) =>
    set((s) => ({
      pins: s.pins.map((p) => (p.id === id ? { ...p, note } : p)),
    })),

  // Renumber survivors so badges stay 1..N and keep matching the screenshot.
  removePin: (id) =>
    set((s) => ({
      pins: s.pins
        .filter((p) => p.id !== id)
        .map((p, i) => ({ ...p, n: i + 1 })),
    })),

  setBox: (box) => set({ box }),

  addStroke: (stroke) => set((s) => ({ strokes: [...s.strokes, stroke] })),

  clearAll: () => set({ pins: [], box: null, strokes: [] }),

  bindModel: (base) =>
    set((s) =>
      s.modelBase === base
        ? {}
        : { modelBase: base, pins: [], box: null, strokes: [] },
    ),

  hasFeedback: () => {
    const s = get();
    return s.pins.length > 0 || s.box !== null || s.strokes.length > 0;
  },
}));
