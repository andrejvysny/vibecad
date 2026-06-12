import { useState } from "react";
import type { BackendId } from "@shared/types";

interface Props {
  onClose(): void;
  onCreate(params: {
    name: string;
    backend: BackendId;
    outputNeed: "print" | "cad";
  }): void;
}

export function NewProjectDialog({ onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [outputNeed, setOutputNeed] = useState<"print" | "cad">("print");

  const backend: BackendId = outputNeed === "cad" ? "build123d" : "openscad";

  function handleCreate() {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), backend, outputNeed });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-white/10 rounded-lg p-6 w-96 space-y-4">
        <h2 className="text-base font-semibold text-gray-100">New Project</h2>

        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Project name
          </label>
          <input
            autoFocus
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-white/30"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-2">
            What do you need to produce?
          </label>
          <div className="space-y-2">
            {(
              [
                {
                  value: "print",
                  label: "STL / 3MF",
                  sub: "3D printing → OpenSCAD",
                },
                {
                  value: "cad",
                  label: "STEP / DXF",
                  sub: "Precise CAD, CAM, CNC → build123d",
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-3 cursor-pointer"
              >
                <input
                  type="radio"
                  name="outputNeed"
                  value={opt.value}
                  checked={outputNeed === opt.value}
                  onChange={() => setOutputNeed(opt.value)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm text-gray-200">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.sub}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
