import { create } from "zustand";
import type { WorkflowRunStatus } from "@shared/types";

// Active-run state lives only in the renderer (lost on reload, by design). The
// main process drives steps and pushes `workflow:step` events we fold in here.
export interface ActiveRun {
  projectId: string;
  slug: string;
  index: number;
  total: number;
  title: string;
  status: WorkflowRunStatus;
  nextStep?: number;
}

interface WorkflowStore {
  run: ActiveRun | null;
  /** Apply a workflow:step push event. */
  onStep(p: ActiveRun): void;
  /** Optimistic local state when the user kicks off / resumes a run. */
  begin(projectId: string, slug: string, fromStep: number): void;
  clear(): void;
}

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  run: null,
  onStep: (p) => set({ run: p }),
  begin: (projectId, slug, fromStep) =>
    set({
      run: {
        projectId,
        slug,
        index: fromStep,
        total: 0,
        title: "",
        status: "running",
      },
    }),
  clear: () => set({ run: null }),
}));
