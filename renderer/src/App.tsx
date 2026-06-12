import { useEffect } from "react";
import { useProjectStore } from "./stores/project.store";
import { useBackendStore } from "./stores/backend.store";
import { useAgentStore } from "./stores/agent.store";
import { WorkspaceTree } from "./components/WorkspaceTree";
import { Preview } from "./components/Preview";
import { Chat } from "./components/Chat";

export function App() {
  const initAgents = useAgentStore((s) => s.detect);
  const initBackends = useBackendStore((s) => s.detect);
  const activeProject = useProjectStore((s) => s.activeProject);

  useEffect(() => {
    void initAgents();
    void initBackends();
  }, [initAgents, initBackends]);

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
    <div className="flex flex-col h-full bg-[#0f1117] text-gray-100">
      {/* Title bar drag region */}
      <div
        className="h-9 flex items-center px-4 shrink-0 select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-gray-400 ml-20">
          OpenSCAD Studio
        </span>
      </div>

      {/* Main 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Workspace tree */}
        <div className="w-56 shrink-0 border-r border-white/10 overflow-hidden flex flex-col">
          <WorkspaceTree project={activeProject} />
        </div>

        {/* Center: Preview */}
        <div className="flex-1 overflow-hidden flex flex-col border-r border-white/10">
          <Preview project={activeProject} />
        </div>

        {/* Right: Chat */}
        <div className="w-96 shrink-0 overflow-hidden flex flex-col">
          <Chat project={activeProject} />
        </div>
      </div>
    </div>
  );
}
