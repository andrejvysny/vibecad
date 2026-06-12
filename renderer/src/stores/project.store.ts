import { create } from "zustand";
import type { AgentId, BackendId } from "@shared/types";
import { useAgentStore } from "./agent.store";
import { latestModelBase } from "./preview";

// localStorage key for the last-opened project (restored on boot).
const LAST_PROJECT_KEY = "opencad:lastProjectId";

export interface Project {
  id: string;
  name: string;
  dir: string;
  agentId: string;
  modelingBackend: "openscad" | "build123d";
  outputNeed: "print" | "cad";
  createdAt: number;
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
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
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
      localStorage.setItem(LAST_PROJECT_KEY, id);
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
    // Newest-first, matching loadProjects' sort.
    set((s) => ({ projects: [project, ...s.projects] }));
  },

  async loadProjects() {
    const records = await window.api.listProjects();
    const projects = records
      .map((r) => ({ ...r, files: [], activeModel: null }))
      .sort((a, b) => b.createdAt - a.createdAt);
    set({ projects });
    if (get().activeProjectId) return;
    const last = localStorage.getItem(LAST_PROJECT_KEY);
    const target = (last && projects.find((p) => p.id === last)) ?? projects[0];
    if (target) get().setActive(target.id);
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

  async renameProject(id, name) {
    await window.api.renameProject({ id, name });
    set((s) => {
      const apply = (p: Project): Project => (p.id === id ? { ...p, name } : p);
      return {
        projects: s.projects.map(apply),
        activeProject: s.activeProject ? apply(s.activeProject) : null,
      };
    });
  },

  async deleteProject(id) {
    await window.api.deleteProject({ id });
    const remaining = get().projects.filter((p) => p.id !== id);
    set({ projects: remaining });
    if (get().activeProjectId !== id) return;
    // Deleted the active project: fall back to the next one, or empty state.
    const next = remaining[0];
    if (next) {
      get().setActive(next.id);
    } else {
      localStorage.removeItem(LAST_PROJECT_KEY);
      set({ activeProjectId: null, activeProject: null });
      useAgentStore.getState().clear();
    }
  },
}));
