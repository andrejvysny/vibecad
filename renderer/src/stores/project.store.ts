import { create } from "zustand";
import type { AgentId, BackendId } from "@shared/types";
import { useAgentStore } from "./agent.store";
import { latestModelBase } from "./preview";

export interface Project {
  id: string;
  name: string;
  dir: string;
  agentId: string;
  modelingBackend: "openscad" | "build123d";
  outputNeed: "print" | "cad";
  files: string[];
  // Active model basename (e.g. "model_003") driving the preview / source view.
  activeModel: string | null;
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  // Bumped whenever a preview mesh is re-exported, to force the viewer to reload
  // even when the STL filename is unchanged.
  meshVersion: number;
  setActive(id: string): void;
  setFiles(projectId: string, files: string[]): void;
  setActiveModel(projectId: string, base: string): void;
  bumpMesh(): void;
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
  meshVersion: 0,

  setActive(id) {
    const project = get().projects.find((p) => p.id === id) ?? null;
    set({ activeProjectId: id, activeProject: project });
    if (project) {
      void window.api.openProject({ id });
      void useAgentStore.getState().loadHistory(id);
    }
  },

  setFiles(projectId, files) {
    set((s) => {
      const apply = (p: Project): Project =>
        p.id === projectId
          ? {
              ...p,
              files,
              // Default the active model to the newest one if none picked yet.
              activeModel: p.activeModel ?? latestModelBase(files),
            }
          : p;
      return {
        projects: s.projects.map(apply),
        activeProject: s.activeProject ? apply(s.activeProject) : null,
      };
    });
  },

  setActiveModel(projectId, base) {
    set((s) => {
      const apply = (p: Project): Project =>
        p.id === projectId ? { ...p, activeModel: base } : p;
      return {
        projects: s.projects.map(apply),
        activeProject: s.activeProject ? apply(s.activeProject) : null,
      };
    });
  },

  bumpMesh() {
    set((s) => ({ meshVersion: s.meshVersion + 1 }));
  },

  addProject(project) {
    set((s) => ({ projects: [...s.projects, project] }));
  },

  async loadProjects() {
    const records = await window.api.listProjects();
    set({
      projects: records.map((r) => ({ ...r, files: [], activeModel: null })),
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
    const project: Project = { ...record, files: [], activeModel: null };
    get().addProject(project);
    get().setActive(record.id);
    return project;
  },
}));
