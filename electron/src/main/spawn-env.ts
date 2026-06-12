/**
 * Build a child-process environment that won't crash GUI-bundle CLIs.
 *
 * On macOS, Electron leaks `__CFBundleIdentifier` (and a GUI launch context)
 * into spawned children. When the child is itself a `.app` binary — e.g. the
 * OpenSCAD 2021.01 GUI binary that `openscad` symlinks to — its CoreFoundation
 * / OpenGL init crashes ("OpenSCAD quit unexpectedly"). Stripping these vars
 * lets openscad/build123d (and agents that spawn them) run headlessly.
 */
export function cleanSpawnEnv(
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env["__CFBundleIdentifier"];
  delete env["ELECTRON_RUN_AS_NODE"];
  return env;
}
