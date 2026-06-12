import { create } from "zustand";
import type { CameraPreset } from "@shared/types";

export interface Project {
  id: string;
  name: string;
  dir: string;
  agentId: string;
  modelingBackend: "openscad" | "build123d";
  outputNeed: "print" | "cad";
  files: string[];
  previews: Partial<Record<CameraPreset, string>>;
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  setActive(id: string): void;
  setFiles(projectId: string, files: string[]): void;
  setPreview(projectId: string, angle: CameraPreset, pngPath: string): void;
  addProject(project: Project): void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,

  setActive(id) {
    const project = get().projects.find((p) => p.id === id) ?? null;
    set({ activeProjectId: id, activeProject: project });
  },

  setFiles(projectId, files) {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, files } : p,
      ),
      activeProject:
        s.activeProject?.id === projectId
          ? { ...s.activeProject, files }
          : s.activeProject,
    }));
  },

  setPreview(projectId, angle, pngPath) {
    set((s) => {
      const update = (p: Project) =>
        p.id === projectId
          ? { ...p, previews: { ...p.previews, [angle]: pngPath } }
          : p;
      return {
        projects: s.projects.map(update),
        activeProject: s.activeProject ? update(s.activeProject) : null,
      };
    });
  },

  addProject(project) {
    set((s) => ({ projects: [...s.projects, project] }));
  },
}));
