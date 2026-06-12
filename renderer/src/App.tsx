import { useEffect, useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { useProjectStore } from "./stores/project.store";
import { useBackendStore } from "./stores/backend.store";
import { useAgentStore } from "./stores/agent.store";
import { useViewStore } from "./stores/view.store";
import { WorkspaceTree } from "./components/WorkspaceTree";
import { Preview } from "./components/Preview";
import { SourceViewer } from "./components/SourceViewer";
import { Chat } from "./components/Chat";
import { Settings } from "./components/Settings";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { IconButton } from "./components/ui";
import { studioUrl } from "./lib/studio";
import type { Project } from "./stores/project.store";

export function App() {
  const initAgents = useAgentStore((s) => s.detect);
  const initBackends = useBackendStore((s) => s.detect);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const activeProject = useProjectStore((s) => s.activeProject);

  const [view, setView] = useState<"workspace" | "settings">("workspace");
  const [showNewProject, setShowNewProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const treePanel = useRef<ImperativePanelHandle>(null);
  const chatPanel = useRef<ImperativePanelHandle>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  const toggle = (ref: React.RefObject<ImperativePanelHandle | null>) => {
    const p = ref.current;
    if (!p) return;
    p.isCollapsed() ? p.expand() : p.collapse();
  };

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
        // New render artifacts may complete a just-finished assistant turn.
        useAgentStore.getState().refreshLastResult();
      },
    );
    const unsubMesh = window.api.onPreviewMeshReady(() => {
      useProjectStore.getState().bumpMesh();
    });
    const unsubPreviewError = window.api.onPreviewError(({ message }) => {
      setError(`Preview render failed: ${message}`);
    });
    return () => {
      unsubEvent();
      unsubWorkspace();
      unsubMesh();
      unsubPreviewError();
    };
  }, []);

  return (
    <div className="relative flex flex-col h-full bg-[#0f1117] text-gray-100">
      {/* Title bar drag region */}
      <div
        className="h-9 flex items-center px-4 shrink-0 select-none gap-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className="ml-20"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <ProjectSwitcher />
        </div>
        <div className="flex-1" />
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <IconButton
            onClick={() => toggle(treePanel)}
            title="Toggle file panel"
            className={treeCollapsed ? "text-gray-600" : ""}
          >
            <PanelLeftIcon />
          </IconButton>
          <IconButton
            onClick={() => toggle(chatPanel)}
            title="Toggle chat panel"
            className={chatCollapsed ? "text-gray-600" : ""}
          >
            <PanelRightIcon />
          </IconButton>
          <button
            onClick={() => setShowNewProject(true)}
            className="px-2 py-0.5 text-xs border border-white/10 rounded text-gray-300 hover:border-white/30 ml-1"
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

      {/* Main 3-panel layout (resizable + collapsible, persisted) */}
      <PanelGroup
        direction="horizontal"
        autoSaveId="opencad-main-layout"
        className="flex-1 overflow-hidden"
      >
        <Panel
          ref={treePanel}
          id="tree"
          order={1}
          defaultSize={16}
          minSize={10}
          collapsible
          collapsedSize={0}
          onCollapse={() => setTreeCollapsed(true)}
          onExpand={() => setTreeCollapsed(false)}
          className="flex flex-col overflow-hidden"
        >
          <WorkspaceTree project={activeProject} />
        </Panel>

        <ResizeHandle />

        <Panel
          id="center"
          order={2}
          minSize={30}
          className="flex flex-col overflow-hidden"
        >
          {view === "settings" ? (
            <Settings />
          ) : (
            <CenterPane project={activeProject} />
          )}
        </Panel>

        <ResizeHandle />

        <Panel
          ref={chatPanel}
          id="chat"
          order={3}
          defaultSize={26}
          minSize={16}
          collapsible
          collapsedSize={0}
          onCollapse={() => setChatCollapsed(true)}
          onExpand={() => setChatCollapsed(false)}
          className="flex flex-col overflow-hidden"
        >
          <Chat project={activeProject} />
        </Panel>
      </PanelGroup>

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

/** Draggable splitter between panels (a hairline with a wider hit area). */
function ResizeHandle() {
  return (
    <PanelResizeHandle className="group relative w-px bg-white/10 outline-none">
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-blue-500/30 group-data-[resize-handle-state=drag]:bg-blue-500/50 transition-colors" />
    </PanelResizeHandle>
  );
}

function PanelLeftIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

function PanelRightIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  );
}

function CenterPane({ project }: { project: Project | null }) {
  const mode = useViewStore((s) => s.mode);
  const file = useViewStore((s) => s.file);

  if (mode === "source" && project && file) {
    return <SourceViewer project={project} file={file} />;
  }
  if (mode === "image" && project && file) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <button
            onClick={() => useViewStore.getState().show3d()}
            className="px-2 py-0.5 text-xs border border-white/10 rounded text-gray-400 hover:border-white/30"
          >
            ← 3D
          </button>
          <span className="text-xs text-gray-400 truncate">{file}</span>
        </div>
        <div className="flex-1 flex items-center justify-center bg-[#0a0d12] overflow-hidden">
          <img
            src={studioUrl(`${project.dir}/${file}`)}
            alt={file}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      </div>
    );
  }
  return <Preview project={project} />;
}
