import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ViewportQuality = "adaptive" | "max" | "performance";
export type ViewportControlPreset = "cad" | "trackpad";
export type ViewportProjection = "perspective" | "orthographic";
export type ViewportMaterialPreset = "cad-blue" | "studio-gray";

export interface ViewportSettings {
  quality: ViewportQuality;
  controlPreset: ViewportControlPreset;
  projection: ViewportProjection;
  materialPreset: ViewportMaterialPreset;
  aoEnabled: boolean;
}

interface ViewportStore extends ViewportSettings {
  setQuality(quality: ViewportQuality): void;
  setControlPreset(controlPreset: ViewportControlPreset): void;
  setProjection(projection: ViewportProjection): void;
  setMaterialPreset(materialPreset: ViewportMaterialPreset): void;
  setAoEnabled(aoEnabled: boolean): void;
}

export const DEFAULT_VIEWPORT_SETTINGS: ViewportSettings = {
  quality: "adaptive",
  controlPreset: "cad",
  projection: "perspective",
  materialPreset: "cad-blue",
  aoEnabled: true,
};

export const useViewportStore = create<ViewportStore>()(
  persist(
    (set) => ({
      ...DEFAULT_VIEWPORT_SETTINGS,
      setQuality: (quality) => set({ quality }),
      setControlPreset: (controlPreset) => set({ controlPreset }),
      setProjection: (projection) => set({ projection }),
      setMaterialPreset: (materialPreset) => set({ materialPreset }),
      setAoEnabled: (aoEnabled) => set({ aoEnabled }),
    }),
    {
      name: "opencad:viewport",
      storage: createJSONStorage(() => localStorage),
      partialize: (state): ViewportSettings => ({
        quality: state.quality,
        controlPreset: state.controlPreset,
        projection: state.projection,
        materialPreset: state.materialPreset,
        aoEnabled: state.aoEnabled,
      }),
    },
  ),
);
