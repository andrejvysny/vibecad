import { create } from "zustand";
import type { AgentId, BackendId, CameraPreset } from "@shared/types";
import { useAgentStore } from "./agent.store";
import { deriveLatestPreviews } from "./preview";

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
  loadProjects(): Promise<void>;
  createProject(params: {
    name: string;
    backend: BackendId;
    outputNeed: "print" | "cad";
  }): Promise<Project>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,

  setActive(id) {
    const project = get().projects.find((p) => p.id === id) ?? null;
    set({ activeProjectId: id, activeProject: project });
    if (project) void window.api.openProject({ id });
  },

  setFiles(projectId, files) {
    set((s) => {
      const apply = (p: Project): Project =>
        p.id === projectId
          ? {
              ...p,
              files,
              previews: {
                ...p.previews,
                ...deriveLatestPreviews(files, p.dir),
              },
            }
          : p;
      return {
        projects: s.projects.map(apply),
        activeProject: s.activeProject ? apply(s.activeProject) : null,
      };
    });
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

  async loadProjects() {
    const records = await window.api.listProjects();
    set({
      projects: records.map((r) => ({ ...r, files: [], previews: {} })),
    });
    const first = get().projects[0];
    if (first && !get().activeProjectId) get().setActive(first.id);
  },

  async createProject({ name, backend, outputNeed }) {
    const agentId = useAgentStore.getState().activeAgentId;
    if (!agentId) {
      throw new Error("No agent available — check Settings → Agent backends.");
    }
    const record = await window.api.createProject({
      name,
      agentId: agentId as AgentId,
      modelingBackend: backend,
      outputNeed,
    });
    const project: Project = { ...record, files: [], previews: {} };
    get().addProject(project);
    get().setActive(record.id);
    return project;
  },
}));
