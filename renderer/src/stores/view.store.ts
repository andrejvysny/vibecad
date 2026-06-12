import { create } from "zustand";

export type CenterMode = "3d" | "source" | "image";

interface ViewStore {
  mode: CenterMode;
  // Project-relative filename being shown in source/image mode.
  file: string | null;
  show3d(): void;
  showSource(file: string): void;
  showImage(file: string): void;
}

export const useViewStore = create<ViewStore>((set) => ({
  mode: "3d",
  file: null,
  show3d: () => set({ mode: "3d", file: null }),
  showSource: (file) => set({ mode: "source", file }),
  showImage: (file) => set({ mode: "image", file }),
}));
