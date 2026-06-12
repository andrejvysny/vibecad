import { useEffect, useState } from "react";
import { useProjectStore } from "./stores/project.store";
import { useBackendStore } from "./stores/backend.store";
import { useAgentStore } from "./stores/agent.store";
import { WorkspaceTree } from "./components/WorkspaceTree";
import { Preview } from "./components/Preview";
import { Chat } from "./components/Chat";
import { Settings } from "./components/Settings";
import { NewProjectDialog } from "./components/NewProjectDialog";

export function App() {
  const initAgents = useAgentStore((s) => s.detect);
  const initBackends = useBackendStore((s) => s.detect);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const activeProject = useProjectStore((s) => s.activeProject);

  const [view, setView] = useState<"workspace" | "settings">("workspace");
  const [showNewProject, setShowNewProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initAgents();
    void initBackends();
    void loadProjects();
  }, [initAgents, initBackends, loadProjects]);

  // Subscribe to push events from main process
  useEffect(() => {
    const unsubEvent = window.api.onAgentEvent((event) => {
      useAgentStore.getState().pushEvent(event);
    });
    const unsubWorkspace = window.api.onWorkspaceChanged(
      ({ projectId, files }) => {
        useProjectStore.getState().setFiles(projectId, files);
      },
    );
    const unsubPreview = window.api.onPreviewUpdated(
      ({ projectId, angle, pngPath }) => {
        useProjectStore.getState().setPreview(projectId, angle, pngPath);
      },
    );
    return () => {
      unsubEvent();
      unsubWorkspace();
      unsubPreview();
    };
  }, []);

  return (
    <div className="relative flex flex-col h-full bg-[#0f1117] text-gray-100">
      {/* Title bar drag region */}
      <div
        className="h-9 flex items-center px-4 shrink-0 select-none gap-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-gray-400 ml-20">
          OpenSCAD Studio
        </span>
        <div className="flex-1" />
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            onClick={() => setShowNewProject(true)}
            className="px-2 py-0.5 text-xs border border-white/10 rounded text-gray-300 hover:border-white/30"
          >
            ＋ New Project
          </button>
          <button
            onClick={() =>
              setView((v) => (v === "settings" ? "workspace" : "settings"))
            }
            className={`px-2 py-0.5 text-xs rounded ${
              view === "settings"
                ? "bg-white/10 text-gray-100"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Main 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Workspace tree */}
        <div className="w-56 shrink-0 border-r border-white/10 overflow-hidden flex flex-col">
          <WorkspaceTree project={activeProject} />
        </div>

        {/* Center: Preview or Settings */}
        <div className="flex-1 overflow-hidden flex flex-col border-r border-white/10">
          {view === "settings" ? (
            <Settings />
          ) : (
            <Preview project={activeProject} />
          )}
        </div>

        {/* Right: Chat */}
        <div className="w-96 shrink-0 overflow-hidden flex flex-col">
          <Chat project={activeProject} />
        </div>
      </div>

      {error && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-lg bg-red-900/90 border border-red-500/40 text-red-100 text-xs rounded px-3 py-2 cursor-pointer"
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}

      {showNewProject && (
        <NewProjectDialog
          onClose={() => setShowNewProject(false)}
          onCreate={({ name, backend, outputNeed }) => {
            void createProject({ name, backend, outputNeed }).catch((e) =>
              setError(e instanceof Error ? e.message : String(e)),
            );
          }}
        />
      )}
    </div>
  );
}
