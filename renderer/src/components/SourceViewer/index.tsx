import { useEffect, useState } from "react";
import { useViewStore } from "../../stores/view.store";
import type { Project } from "../../stores/project.store";

interface Props {
  project: Project;
  file: string;
}

export function SourceViewer({ project, file }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `${project.dir}/${file}`;

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    window.api
      .readModel({ path })
      .then((t) => !cancelled && setText(t))
      .catch(
        (e) =>
          !cancelled && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      cancelled = true;
    };
  }, [path]);

  const lines = text?.split("\n") ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <button
          onClick={() => useViewStore.getState().show3d()}
          className="px-2 py-0.5 text-xs border border-white/10 rounded text-gray-400 hover:border-white/30"
        >
          ← 3D
        </button>
        <span className="text-xs text-gray-300 truncate flex-1">{file}</span>
        <span className="text-[10px] text-gray-600 uppercase tracking-wide">
          read-only
        </span>
        <button
          onClick={() => void window.api.revealItem({ path })}
          title="Reveal in Finder"
          className="px-2 py-0.5 text-xs border border-white/10 rounded text-gray-400 hover:border-white/30"
        >
          ↗
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-[#0a0d12]">
        {error ? (
          <p className="text-red-400 text-sm p-4">{error}</p>
        ) : text === null ? (
          <p className="text-gray-600 text-sm p-4">Loading…</p>
        ) : (
          <pre className="text-xs leading-relaxed font-mono text-gray-200">
            <code>
              {lines.map((line, i) => (
                <div key={i} className="flex">
                  <span className="select-none text-right text-gray-600 w-10 pr-3 shrink-0">
                    {i + 1}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line}</span>
                </div>
              ))}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}
