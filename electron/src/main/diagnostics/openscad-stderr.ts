export interface StderrParse {
  errors: string[];
  warnings: string[];
}

// Non-`ERROR:` lines that still mean the export produced no usable solid. These
// can accompany an exit code of 0, so the geometry-only gates would miss them.
const HARD_PATTERNS = [
  /No top level geometry to render/i,
  /Current top level object is not a 3D object/i,
];

/**
 * Split OpenSCAD's stderr into repair-driving errors vs context warnings. Pure.
 * `ERROR:` lines + the hard patterns above are errors; every `WARNING:` line
 * (CGAL/2-manifold/mesh advisories) is a warning.
 */
export function parseOpenscadStderr(text: string): StderrParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^ERROR:/.test(line) || HARD_PATTERNS.some((re) => re.test(line))) {
      errors.push(line);
    } else if (/^WARNING:/.test(line)) {
      warnings.push(line);
    }
  }
  return { errors, warnings };
}
