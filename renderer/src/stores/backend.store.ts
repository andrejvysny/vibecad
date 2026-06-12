import { create } from "zustand";
import type { DetectedBackend } from "@shared/types";

interface BackendStore {
  detected: DetectedBackend[];
  detect(): Promise<void>;
}

export const useBackendStore = create<BackendStore>((set) => ({
  detected: [],

  async detect() {
    const backends = await window.api.detectBackends();
    set({ detected: backends });
  },
}));
