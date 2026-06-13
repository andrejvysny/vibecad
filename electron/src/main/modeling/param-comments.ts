import type { Param } from "../../../../shared/types.js";

// Shared param-comment parsing for both backends: OpenSCAD Customizer `// [..]`
// comments and build123d `# PARAM [..]` annotations use the same grammar.

const UNIT_RE = /\bin\s+(mm|cm|m|inch|in)\s*$/i;
const SECTION_RE = /^\s*(?:\/\/|#)\s*={2,}\s*(.+?)\s*={2,}\s*$/;

/** Classify a raw RHS literal into a parameter type + parsed value. */
export function classify(raw: string): {
  type: Param["type"];
  value: Param["value"];
} {
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "false") {
    return { type: "boolean", value: lower === "true" };
  }
  if (/^-?\d+$/.test(raw)) return { type: "integer", value: parseInt(raw, 10) };
  if (/^-?\d*\.?\d+$/.test(raw)) {
    return { type: "number", value: parseFloat(raw) };
  }
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return { type: "string", value: raw.slice(1, -1) };
  }
  if (raw.startsWith("[")) return { type: "array", value: raw };
  return { type: "expression", value: raw };
}

/**
 * Parse a Customizer comment (`[min:max] desc`, `[min:step:max] desc`,
 * `[a,b] desc`, or just `desc`) onto `p`, deriving a trailing `… in mm` unit.
 */
export function parseComment(comment: string, p: Param): void {
  if (!comment) return;
  let desc = comment;
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(comment);
  if (m) {
    const bracket = (m[1] ?? "").trim();
    desc = (m[2] ?? "").trim();
    if (bracket.includes(":") && !bracket.includes(",")) {
      const parts = bracket.split(":").map((s) => parseFloat(s.trim()));
      if (parts.length === 2) {
        [p.min, p.max] = parts as [number, number];
      } else if (parts.length === 3) {
        [p.min, p.step, p.max] = parts as [number, number, number];
      }
    } else {
      p.options = bracket
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  const um = UNIT_RE.exec(desc);
  if (um) {
    p.unit = (um[1] ?? "").toLowerCase();
    desc = desc.slice(0, um.index).trim();
  }
  if (desc) p.description = desc;
}

/** Section heading from a `// === Name ===` / `# === Name ===` line, else null. */
export function sectionOf(line: string): string | null {
  const m = SECTION_RE.exec(line);
  return m ? (m[1] ?? "").trim() : null;
}
