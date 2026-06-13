import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSelectionStore,
  type Box,
  type Stroke,
} from "../../stores/selection.store";
import { registerAnnotationCapture } from "../../lib/annotationBridge";
import type { Viewer } from "./viewer";

interface Props {
  viewer: Viewer | null;
}

type LiveBox = { x0: number; y0: number; x1: number; y1: number };

// How many points per axis to raycast inside a region box when deriving its
// approximate model-space bounding box.
const BBOX_GRID = 7;

/** Local CSS-pixel coords within the overlay from a pointer event. */
function localXY(
  e: React.PointerEvent,
  el: HTMLElement,
): { x: number; y: number; rect: DOMRect } {
  const rect = el.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
}

/** Raycast a grid inside a screen rect; reduce hits to a model-space bbox. */
function deriveBbox(viewer: Viewer, rect: DOMRect, b: LiveBox): Box["bbox"] {
  const x0 = Math.min(b.x0, b.x1);
  const y0 = Math.min(b.y0, b.y1);
  const x1 = Math.max(b.x0, b.x1);
  const y1 = Math.max(b.y0, b.y1);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let hits = 0;
  for (let i = 0; i < BBOX_GRID; i++) {
    for (let j = 0; j < BBOX_GRID; j++) {
      const px = rect.left + x0 + ((x1 - x0) * i) / (BBOX_GRID - 1);
      const py = rect.top + y0 + ((y1 - y0) * j) / (BBOX_GRID - 1);
      const hit = viewer.pickPoint(px, py);
      if (!hit) continue;
      hits++;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, hit.world[k]!);
        max[k] = Math.max(max[k]!, hit.world[k]!);
      }
    }
  }
  if (!hits) return null;
  const round = (n: number): number => Math.round(n * 100) / 100;
  return {
    min: min.map(round) as [number, number, number],
    max: max.map(round) as [number, number, number],
  };
}

/** Composite the viewer canvas + marks into a PNG; returns base64 (no prefix). */
async function composite(
  viewer: Viewer,
  overlay: HTMLElement,
  pins: ReturnType<typeof useSelectionStore.getState>["pins"],
  box: Box | null,
  strokes: Stroke[],
): Promise<string | null> {
  const url = viewer.captureCanvas();
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("screenshot decode failed"));
    img.src = url;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  // Marks are positioned in overlay CSS px; scale to the drawing-buffer size.
  const rect = overlay.getBoundingClientRect();
  const sx = w / (rect.width || 1);
  const sy = h / (rect.height || 1);

  ctx.lineWidth = 2 * sx;
  ctx.strokeStyle = "#f59e0b";
  ctx.fillStyle = "#f59e0b";

  for (const s of strokes) {
    ctx.beginPath();
    s.pts.forEach(([nx, ny], i) => {
      const x = nx * w;
      const y = ny * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (box) {
    ctx.strokeRect(
      box.screen.x * sx,
      box.screen.y * sy,
      box.screen.w * sx,
      box.screen.h * sy,
    );
  }

  ctx.font = `bold ${14 * sx}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of pins) {
    const pt = viewer.project(p.world);
    if (!pt.visible) continue;
    const x = pt.x * sx;
    const y = pt.y * sy;
    ctx.beginPath();
    ctx.arc(x, y, 10 * sx, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(String(p.n), x, y);
    ctx.fillStyle = "#f59e0b";
  }

  return canvas.toDataURL("image/png").split(",")[1] ?? null;
}

/**
 * Transparent layer over the 3D canvas. When a tool is active it captures
 * pointer events (so the camera underneath stays still) and lets the user drop
 * pins, drag a region box, or scribble. Pins are 3D-anchored and re-projected
 * each frame; box + strokes are screen-space. Exposes a capture fn via the
 * annotation bridge for the chat composer's Send.
 */
export function AnnotationOverlay({ viewer }: Props) {
  const tool = useSelectionStore((s) => s.tool);
  const pins = useSelectionStore((s) => s.pins);
  const box = useSelectionStore((s) => s.box);
  const strokes = useSelectionStore((s) => s.strokes);
  const addPin = useSelectionStore((s) => s.addPin);
  const setPinNote = useSelectionStore((s) => s.setPinNote);
  const removePin = useSelectionStore((s) => s.removePin);
  const setBox = useSelectionStore((s) => s.setBox);
  const addStroke = useSelectionStore((s) => s.addStroke);

  const ref = useRef<HTMLDivElement>(null);
  const [liveBox, setLiveBox] = useState<LiveBox | null>(null);
  const [liveStroke, setLiveStroke] = useState<[number, number][] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped each frame to re-project 3D-anchored pins as the camera moves.
  const [, setFrame] = useState(0);

  // Register the screenshot compositor so the chat composer can call it.
  useEffect(() => {
    registerAnnotationCapture(() =>
      viewer && ref.current
        ? composite(viewer, ref.current, pins, box, strokes)
        : Promise.resolve(null),
    );
    return () => registerAnnotationCapture(null);
  }, [viewer, pins, box, strokes]);

  // Keep pin badges glued to the model while orbiting (cheap: a few pins).
  useEffect(() => {
    if (pins.length === 0) return;
    let raf = 0;
    const tick = (): void => {
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pins.length]);

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      if (tool === "orbit" || !ref.current || !viewer) return;
      const el = ref.current;
      if (tool === "pin") {
        const hit = viewer.pickPoint(e.clientX, e.clientY);
        if (hit) setEditing(addPin(hit.world));
        return;
      }
      const { x, y } = localXY(e, el);
      el.setPointerCapture(e.pointerId);
      if (tool === "box") setLiveBox({ x0: x, y0: y, x1: x, y1: y });
      else setLiveStroke([[x, y]]);
    },
    [tool, viewer, addPin],
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (!ref.current) return;
      const { x, y } = localXY(e, ref.current);
      if (liveBox) setLiveBox((b) => (b ? { ...b, x1: x, y1: y } : b));
      else if (liveStroke) setLiveStroke((s) => (s ? [...s, [x, y]] : s));
    },
    [liveBox, liveStroke],
  );

  const onUp = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current;
      if (el?.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
      if (liveBox && viewer && el) {
        const rect = el.getBoundingClientRect();
        const x = Math.min(liveBox.x0, liveBox.x1);
        const y = Math.min(liveBox.y0, liveBox.y1);
        const w = Math.abs(liveBox.x1 - liveBox.x0);
        const h = Math.abs(liveBox.y1 - liveBox.y0);
        if (w > 4 && h > 4) {
          setBox({
            screen: { x, y, w, h },
            bbox: deriveBbox(viewer, rect, liveBox),
          });
        }
        setLiveBox(null);
      }
      if (liveStroke && el) {
        const rect = el.getBoundingClientRect();
        if (liveStroke.length > 1) {
          addStroke({
            pts: liveStroke.map(([px, py]) => [
              px / rect.width,
              py / rect.height,
            ]),
          });
        }
        setLiveStroke(null);
      }
    },
    [liveBox, liveStroke, viewer, setBox, addStroke],
  );

  const interactive = tool !== "orbit";

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      style={{ pointerEvents: interactive ? "auto" : "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {strokes.map((s, i) => (
          <Polyline key={`s${i}`} pts={s.pts} el={ref.current} />
        ))}
        {liveStroke && liveStroke.length > 1 && (
          <polyline
            points={liveStroke.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={2}
          />
        )}
        {box && (
          <rect
            x={box.screen.x}
            y={box.screen.y}
            width={box.screen.w}
            height={box.screen.h}
            fill="rgba(245,158,11,0.08)"
            stroke="#f59e0b"
            strokeWidth={1.5}
          />
        )}
        {liveBox && (
          <rect
            x={Math.min(liveBox.x0, liveBox.x1)}
            y={Math.min(liveBox.y0, liveBox.y1)}
            width={Math.abs(liveBox.x1 - liveBox.x0)}
            height={Math.abs(liveBox.y1 - liveBox.y0)}
            fill="rgba(245,158,11,0.08)"
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
      </svg>

      {viewer &&
        pins.map((p) => {
          const pt = viewer.project(p.world);
          if (!pt.visible) return null;
          return (
            <PinBadge
              key={p.id}
              n={p.n}
              note={p.note}
              x={pt.x}
              y={pt.y}
              editing={editing === p.id}
              onOpen={() => setEditing(p.id)}
              onNote={(v) => setPinNote(p.id, v)}
              onClose={() => setEditing(null)}
              onRemove={() => {
                removePin(p.id);
                setEditing(null);
              }}
            />
          );
        })}
    </div>
  );
}

function Polyline({
  pts,
  el,
}: {
  pts: [number, number][];
  el: HTMLElement | null;
}) {
  const w = el?.clientWidth ?? 0;
  const h = el?.clientHeight ?? 0;
  return (
    <polyline
      points={pts.map(([x, y]) => `${x * w},${y * h}`).join(" ")}
      fill="none"
      stroke="#f59e0b"
      strokeWidth={2}
    />
  );
}

function PinBadge({
  n,
  note,
  x,
  y,
  editing,
  onOpen,
  onNote,
  onClose,
  onRemove,
}: {
  n: number;
  note: string;
  x: number;
  y: number;
  editing: boolean;
  onOpen: () => void;
  onNote: (v: string) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: x, top: y, pointerEvents: "auto" }}
    >
      <button
        onClick={onOpen}
        className="grid place-items-center w-5 h-5 rounded-full bg-amber-500 text-[11px] font-bold text-black border border-black/30 shadow"
        title={note || "Add a note"}
      >
        {n}
      </button>
      {editing && (
        <div
          className="absolute left-1/2 top-6 -translate-x-1/2 z-10 flex items-center gap-1 rounded-md border border-white/15 bg-[#161a22] px-1.5 py-1 shadow-xl"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={note}
            placeholder={`Note for ${n} (optional)`}
            onChange={(e) => onNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") onClose();
            }}
            className="w-40 bg-transparent text-[11px] text-gray-100 placeholder-gray-500 focus:outline-none"
          />
          <button
            onClick={onRemove}
            title="Remove pin"
            className="text-gray-500 hover:text-red-400 text-xs leading-none"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
