import { useCallback, useEffect, useRef, useState } from "react";
import type { Param } from "@shared/types";
import { useProjectStore } from "../../stores/project.store";
import { cn } from "../../lib/cn";
import type { Project } from "../../stores/project.store";

interface Props {
  project: Project;
}

type Value = number | string | boolean;

const SOURCE_EXT: Record<string, string> = {
  openscad: ".scad",
  build123d: ".py",
};

/**
 * Direct-manipulation parameter editor overlaid on the viewport. Reads the
 * active model's customizer params via `extractParams`, and on edit patches the
 * source line + re-renders — no agent round-trip. Debounced ~300ms so a slider
 * drag commits once it settles. Hidden when the model exposes no params.
 */
export function ParamPanel({ project }: Props) {
  const meshVersion = useProjectStore((s) => s.meshVersion);
  const [params, setParams] = useState<Param[]>([]);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<"idle" | "applying" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const modelPath = project.activeModel
    ? `${project.dir}/${project.activeModel}${SOURCE_EXT[project.modelingBackend] ?? ".scad"}`
    : null;

  // (Re)load params when the active model changes or is re-rendered (agent edit).
  useEffect(() => {
    if (!modelPath) {
      setParams([]);
      return;
    }
    let cancelled = false;
    window.api
      .extractParams({ projectId: project.id, modelPath })
      .then((p) => {
        if (cancelled) return;
        setParams(p);
        setValues(Object.fromEntries(p.map((x) => [x.name, x.value])));
      })
      .catch(() => !cancelled && setParams([]));
    return () => {
      cancelled = true;
    };
  }, [project.id, modelPath, meshVersion]);

  const commit = useCallback(
    (name: string, value: Value) => {
      if (!modelPath) return;
      clearTimeout(timers.current[name]);
      timers.current[name] = setTimeout(() => {
        setStatus("applying");
        setErrorMsg(null);
        window.api
          .setParam({ projectId: project.id, modelPath, name, value })
          .then((res) => {
            if (res.ok) {
              setStatus("idle");
            } else {
              setStatus("error");
              setErrorMsg(res.errors[0] ?? "Edit rejected");
            }
          })
          .catch((e) => {
            setStatus("error");
            setErrorMsg(e instanceof Error ? e.message : String(e));
          });
      }, 300);
    },
    [project.id, modelPath],
  );

  function update(name: string, value: Value) {
    setValues((v) => ({ ...v, [name]: value }));
    commit(name, value);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- timers ref cleanup
  useEffect(
    () => () => Object.values(timers.current).forEach(clearTimeout),
    [],
  );

  if (params.length === 0) return null;

  return (
    <div className="absolute top-3 left-3 w-60 rounded-lg border border-white/10 bg-[#11151c]/90 backdrop-blur-md shadow-xl text-xs">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between w-full px-3 py-2 text-gray-300"
      >
        <span className="font-medium uppercase tracking-wide text-[11px] text-gray-400">
          Parameters
        </span>
        <span className="flex items-center gap-2">
          {status === "applying" && <Spinner />}
          {status === "error" && <span className="text-amber-400">!</span>}
          <Chevron open={!collapsed} />
        </span>
      </button>
      {!collapsed && (
        <div className="max-h-[60vh] overflow-y-auto px-3 pb-3 space-y-3">
          {errorMsg && (
            <p className="text-amber-400/90 leading-snug">{errorMsg}</p>
          )}
          {params.map((p) => (
            <Control
              key={p.name}
              param={p}
              value={values[p.name] ?? p.value}
              onChange={(v) => update(p.name, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Control({
  param,
  value,
  onChange,
}: {
  param: Param;
  value: Value;
  onChange: (v: Value) => void;
}) {
  const label = (
    <div className="flex items-center justify-between text-gray-400">
      <span className="truncate" title={param.description}>
        {param.name}
      </span>
      {typeof value !== "boolean" && (
        <span className="text-gray-300 ml-2 tabular-nums">{String(value)}</span>
      )}
    </div>
  );

  // Boolean → toggle.
  if (param.type === "boolean" || typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between text-gray-400">
        <span className="truncate" title={param.description}>
          {param.name}
        </span>
        <Toggle on={value === true} onClick={() => onChange(!value)} />
      </div>
    );
  }

  // String with options → select.
  if (param.options && param.options.length > 0) {
    return (
      <label className="block space-y-1">
        {label}
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-gray-200 focus:outline-none focus:border-white/30"
        >
          {param.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // Numeric with a range → slider.
  if (
    typeof value === "number" &&
    param.min !== undefined &&
    param.max !== undefined
  ) {
    const step = param.step ?? (param.type === "integer" ? 1 : 0.01);
    return (
      <label className="block space-y-1">
        {label}
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
      </label>
    );
  }

  // Bare number → numeric input (commit on Enter/blur).
  if (typeof value === "number") {
    return (
      <label className="block space-y-1">
        <span
          className="text-gray-400 truncate block"
          title={param.description}
        >
          {param.name}
        </span>
        <input
          type="number"
          defaultValue={value}
          step={param.type === "integer" ? 1 : "any"}
          onBlur={(e) => onChange(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange(Number(e.currentTarget.value));
          }}
          className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-gray-200 focus:outline-none focus:border-white/30 tabular-nums"
        />
      </label>
    );
  }

  // array / expression → read-only.
  return (
    <div className="flex items-center justify-between text-gray-500">
      <span className="truncate" title={param.description}>
        {param.name}
      </span>
      <span className="text-gray-600 italic">expr</span>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-8 h-4 rounded-full transition-colors relative shrink-0",
        on ? "bg-blue-500/70" : "bg-white/15",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
          on ? "left-4" : "left-0.5",
        )}
      />
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className={cn("transition-transform", open ? "rotate-90" : "")}
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      className="animate-spin text-blue-400"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 00-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
