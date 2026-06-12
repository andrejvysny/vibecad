# OpenSCAD Studio — Application Specification

**Version:** 0.2 (Draft)
**Date:** 2026-06-12
**Author:** Risko & Claude
**Changes from v0.1:** Added a **dual modeling backend** layer. The app now supports both **OpenSCAD** (`.scad`, mesh/CSG, STL/3MF) and **build123d** (`.py`, OpenCascade B-rep, STL/3MF/**STEP**/DXF), selected per project by the user's output need.

---

## 1. Vision

OpenSCAD Studio is a **local-first, agent-native desktop app** for 3D parametric CAD modeling.
It wraps the AI coding agent the user already has installed (Claude Code, OpenCode, Codex) in a purpose-built
UI — chat interface, live preview, workspace manager — without ever touching an API key or billing account itself.

The app does not reimplement an AI. It delegates the entire agent loop to the CLI tool the user already has,
feeds it a curated **modeling skill**, and streams the output back as a coherent design experience.

It supports **two modeling backends** so the user can choose the right geometry engine for the job:

- **OpenSCAD** — simplest path, ideal for 3D-printable parts (STL / 3MF).
- **build123d** — OpenCascade-powered, for precise mechanical CAD with **STEP / DXF** export.

**Core thesis:** The coding-agent space and the code-CAD space have each converged on a few strong tools.
Wrapping them — on both axes — is better than reinventing them.

> **Naming note:** "OpenSCAD Studio" predates dual-backend support. A more neutral name (e.g. *CodeCAD Studio*)
> may be worth adopting before public release. Tracked in §22.

---

## 2. Two Orthogonal Backend Axes

The whole design rests on separating two independent concerns:

| Axis | Question it answers | Options |
|---|---|---|
| **Agent backend** | *How does the AI run?* | Claude Code · OpenCode · Codex |
| **Modeling backend** | *What does the AI write, and how is it rendered/exported?* | OpenSCAD · build123d |

These axes are **orthogonal** — any agent can drive any modeling backend. The **skill** is the bridge: it
tells the chosen agent which language to write and which render/export loop to follow.

```
                  MODELING BACKEND
                  OpenSCAD        build123d
              ┌───────────────┬───────────────┐
   Claude Code│  .scad loop   │   .py loop    │
              ├───────────────┼───────────────┤
A   OpenCode  │  .scad loop   │   .py loop    │
G             ├───────────────┼───────────────┤
E   Codex     │  .scad loop   │   .py loop    │
N             └───────────────┴───────────────┘
T
```

---

## 3. Goals

| Priority | Goal |
|---|---|
| P0 | Run entirely on user's existing CLI auth — no API key in the app |
| P0 | Support Claude Code, OpenCode, Codex as agent backends |
| P0 | **Support OpenSCAD and build123d as modeling backends** |
| P0 | **Let the user choose output need (STL/3MF vs STEP/DXF) → selects backend** |
| P0 | Generate, preview, and export models via natural language |
| P1 | Live PNG preview auto-refreshes on every model change |
| P1 | Multi-angle preview (front / top / isometric) — uniform across both backends |
| P1 | Workspace versioning — numbered iterations (`model_001`, `model_002`, …) |
| P1 | **Capability-driven UI — export buttons rendered from the active backend** |
| P2 | STL / 3MF / STEP / DXF export to disk (per backend capability) |
| P2 | Parameter panel — editable numeric parameters extracted from source |
| P2 | Session persistence across app restarts |

**Out of scope (v0.x):**
- Cloud sync
- Multi-user collaboration
- Direct slicer integration
- Any CAD kernel beyond OpenSCAD (CGAL) and build123d (OpenCascade)

---

## 4. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Shell | **Electron** | Desktop, filesystem access, `child_process` |
| Runtime | **Bun** | Fast, already in use across projects |
| UI | **React 19** | Component model, hooks |
| State | **Zustand** | Lightweight, no boilerplate |
| Persistence | **SQLite + Drizzle ORM** | Sessions, model history, exports |
| Styling | **Tailwind CSS** | Utility-first |
| IPC | Electron `ipcMain` / `ipcRenderer` | Typed, structured communication |
| Agent bridge | `child_process.spawn` | Subprocess control of local CLI agents |
| **Modeling bridge** | `child_process.spawn` | Drives `openscad` binary **or** a bundled Python harness |
| **Python (build123d only)** | User's `python` + `build123d` + `f3d` | Detected, not bundled in v0.x (see §20) |

---

## 5. Supported Agent Backends

### 5.1 Claude Code

```
Invocation:  claude --print --output-format stream-json --add-dir <skillsDir>
Prompt:      via stdin (avoids argv E2BIG / ENAMETOOLONG on Windows)
Auth:        reads ~/.claude.json — user's own API key or Max subscription
Output:      newline-delimited JSON events (stream-json format)
```

Event types parsed: `system`, `assistant` (text deltas with `--include-partial-messages --verbose`),
`tool_use`, `tool_result`, `result`.
Resume: `--resume <session_id>` for multi-turn conversations.

### 5.2 OpenCode

```
Invocation:  opencode run "<prompt>" --format json
             (or: opencode serve + opencode run --attach http://localhost:4096)
Auth:        user's own opencode.json credentials
Output:      JSON / NDJSON events
```

Notes: prefer `opencode serve` to avoid MCP cold-boot per run; use `--agent build` (or a custom agent
with `allowAll`) to avoid interactive permission prompts blocking the subprocess.

### 5.3 Codex CLI

```
Invocation:  codex --approval-mode auto-edit -q "<prompt>"
Auth:        OPENAI_API_KEY from user's environment (not set by the app)
Output:      plain text stream (not structured JSON)
```

Notes: no structured events — show streaming text only; tool calls are not observable.

---

## 6. Supported Modeling Backends

### 6.1 OpenSCAD

```
Source:   .scad (custom DSL)
Kernel:   CGAL (mesh / CSG)
Render:   built-in headless PNG renderer with camera presets
Export:   STL, OFF, 3MF
```

- **Strength:** single ~40 MB binary; the `agent writes file → render PNG` loop is native.
- **Limit:** mesh-only; no precise NURBS; STL is lossy; **no STEP**.

### 6.2 build123d

```
Source:   .py (standard Python)
Kernel:   OpenCascade (B-rep / NURBS) via OCP bindings
Render:   bundled Python harness → f3d (or VTK) → PNG
Export:   STL, 3MF, STEP, DXF
```

- **Strength:** true B-rep — fillets, smooth surfaces, **STEP/DXF** interchange for CAM/CNC.
- **Limit:** heavier (Python + OpenCascade runtime); PNG rendering is not built in — the app ships a
  small render harness (§17.3).
- **Why build123d over CadQuery:** build123d is derived from CadQuery but refactored into a more modern,
  Pythonic framework over OpenCascade — cleaner for an LLM to write. CadQuery remains a possible third
  backend later (same interface).

### 6.3 Capability matrix

| Backend | `sourceExt` | `exports` | Render |
|---|---|---|---|
| **openscad** | `.scad` | `stl`, `3mf` | built-in |
| **build123d** | `.py` | `stl`, `3mf`, `step`, `dxf` | harness (f3d/VTK) |

The `exports` list is the **single source of truth** for the export UI (§12.4).

---

## 7. Output Need → Backend Selection

The backend is a **per-project property**, chosen at creation, because "do I need STEP?" is a
project-level decision. A **global default** in Settings seeds it; the per-project value overrides.

```
┌─ New project ──────────────────────────────────────────┐
│  What do you need to produce?                           │
│                                                         │
│   ○ STL / 3MF    — 3D printing            → openscad    │
│   ○ STEP / DXF   — precise CAD, CAM, CNC  → build123d   │
│                                                         │
│   ▸ Advanced: choose backend directly   [ openscad ▼ ] │
└─────────────────────────────────────────────────────────┘
```

```typescript
function pickBackend(need: 'print' | 'cad'): BackendId {
  return need === 'cad' ? 'build123d' : 'openscad'
}
```

If the chosen backend is **not available** on the machine (e.g. build123d selected but `f3d` missing),
the app blocks creation and links to the Settings → Modeling backends panel (§14) with the exact
missing dependencies.

---

## 8. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     Renderer Process (React)                    │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐    │
│  │  Chat panel  │   │ Preview pane │   │  Workspace tree │    │
│  │  (streaming) │   │ (PNG viewer) │   │ (.scad/.py/.stl)│    │
│  └──────┬───────┘   └──────┬───────┘   └────────┬────────┘    │
│         │                  │                     │             │
└─────────┼──────────────────┼─────────────────────┼─────────────┘
          │     ipcRenderer (typed channels)        │
┌─────────┼──────────────────┼─────────────────────┼─────────────┐
│         │   Main Process (Node / Bun)             │             │
│  ┌──────▼───────┐   ┌───────▼─────────┐   ┌───────▼─────────┐  │
│  │ Agent        │   │ Modeling backend│   │  fs.watch /     │  │
│  │ adapter pool │   │ pool      (NEW) │   │  workspace mgr  │  │
│  │ claude/      │   │ openscad/       │   │                 │  │
│  │ opencode/    │   │ build123d       │   │                 │  │
│  │ codex        │   │ .render()       │   │                 │  │
│  │              │   │ .export()       │   │                 │  │
│  │  injects ───────▶│ .validate()     │   │                 │  │
│  │  skill       │   │ .exports[] caps │   │                 │  │
│  └──────┬───────┘   └───────┬─────────┘   └─────────────────┘  │
│         │                   │                                   │
│         │           ┌───────▼────────────┐                      │
│         │           │ openscad runner    │  built-in PNG        │
│         │           │ build123d runner   │  python + f3d/VTK    │
│         │           └───────┬────────────┘                      │
│  ┌──────▼───────────────────▼──────────────────────────────┐   │
│  │                 SQLite (Drizzle ORM)                     │   │
│  │  projects · sessions · messages · models · exports       │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
          │                   │
          ▼                   ▼
   local CLI agent     openscad binary  OR  python + build123d + f3d
   (claude/opencode    (in PATH)            (detected env)
    /codex)
```

The dual-backend change is **fully contained** in the new *Modeling backend pool* + *runner* layer.
Agent adapters, IPC, workspace manager, and most of the schema are untouched.

---

## 9. Agent Adapter Interface

Each CLI implements a common adapter in `main/agents/`:

```typescript
interface AgentAdapter {
  readonly id: 'claude-code' | 'opencode' | 'codex'
  readonly name: string

  detect(): Promise<string | null>          // binary path or null
  spawn(opts: SpawnOpts): ChildProcess
  parseEvent(line: string): AgentEvent
  kill(child: ChildProcess): void
}

interface SpawnOpts {
  prompt: string
  workingDir: string
  skillsDir: string          // resolved from the project's modeling backend (§11)
  sessionId?: string         // resume (Claude Code only)
  env?: Record<string, string>
}

interface AgentEvent {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'done' | 'error' | 'raw'
  payload: unknown
}
```

`ANTHROPIC_API_KEY` is **never** set by the app — Claude Code reads its own `~/.claude.json`.

---

## 10. Modeling Backend Interface (NEW)

Mirrors `AgentAdapter` for consistency. Implemented in `main/modeling/`.

```typescript
type ExportFormat = 'stl' | '3mf' | 'step' | 'dxf'
type CameraPreset = 'front' | 'top' | 'iso'
type BackendId    = 'openscad' | 'build123d'

interface ModelingBackend {
  readonly id: BackendId
  readonly name: string
  readonly sourceExt: '.scad' | '.py'
  readonly exports: ExportFormat[]      // CAPABILITY list — drives the UI
  readonly skillId: string              // which skill the agent receives

  detect(): Promise<BackendStatus>
  render(req: RenderRequest): Promise<string[]>            // → png paths
  export(modelPath: string, format: ExportFormat): Promise<string>
  validate(modelPath: string): Promise<ValidationResult>
  extractParams(source: string): Promise<Param[]>
}

interface RenderRequest {
  modelPath: string
  outDir: string
  cameras: CameraPreset[]
  size: [number, number]
}

interface BackendStatus {
  available: boolean
  detail: string                        // binary path OR python env path
  missing?: string[]                    // e.g. ['python', 'build123d', 'f3d']
}

interface ValidationResult { ok: boolean; errors: string[] }
interface Param { name: string; value: number; unit?: string; line: number }
```

Both backends expose the **same `render()` contract** — the renderer difference (built-in vs harness)
is hidden inside each implementation, so the Preview pane code is backend-agnostic.

---

## 11. Skill Injection

Each modeling backend ships its own skill. The active project's backend determines which skill the agent
receives — the agent backend never needs to know which CAD language it is writing.

```
{workspaceDir}/.studio/skills/
  openscad/        ← OpenSCAD syntax, CSG patterns, camera presets, STL/3MF export
  build123d/       ← build123d API, B-rep patterns, harness contract, STEP/DXF export
```

Injection per agent:

| Agent | Mechanism |
|---|---|
| **Claude Code** | `--add-dir {workspaceDir}/.studio/skills/{skillId}` |
| **OpenCode** | skill content prepended as system context in the session config |
| **Codex** | skill inlined at the top of the prompt via a template wrapper |

Each skill teaches the agent to:
- write the model to `model_NNN.{scad|py}` in the project dir,
- follow the **render → validate → export** loop,
- generate three camera previews (front / top / iso),
- (build123d only) assign the final solid to a top-level `result` variable so the harness can find it.

---

## 12. UI Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  [≡]  OpenSCAD Studio   [agent: Claude Code ▼] [backend: build123d] [⚙]│
├──────────────────┬─────────────────────────┬──────────────────────┤
│  WORKSPACE       │     PREVIEW             │   CHAT               │
│  ─────────────   │     ─────────────────   │   ─────────────────  │
│  project/        │     [Front] [Top] [Iso] │   > Create a 30mm    │
│  ├ model_001.py  │   ┌─────────────────┐   │     cylinder with    │
│  ├ model_001_*.png│  │                 │   │     a 5mm hole       │
│  ├ model_002.py  │   │   PNG preview   │   │                      │
│  ├ model_002_*.png│  │   (isometric)   │   │   ◉ Writing model_002│
│  └ model_002.step│   │                 │   │   ◉ Rendering...     │
│                  │   └─────────────────┘   │   ✓ Done             │
│  [+ New project] │   [Export STL][STEP]    │   [____prompt____]   │
│                  │   [Open externally]     │   [Send ▶]           │
└──────────────────┴─────────────────────────┴──────────────────────┘
```

The top bar shows **both** the active agent and the active modeling backend (read-only; backend is fixed
per project).

### 12.1 Chat Panel
- Streaming text from agent stdout, rendered as markdown.
- Tool-use events shown as collapsible status pills: `◉ Writing model_002.py` / `◉ Rendering` / `✓ Done`.
- Multi-turn: each send continues the session (Claude Code `--resume`).
- Stop button kills the subprocess mid-stream.

### 12.2 Preview Pane
- Displays PNGs produced by the active backend's `render()`.
- Three tabs: Front / Top / Iso — identical UX for both backends.
- Auto-refreshes when a new `.png` appears (via `fs.watch`).
- "Open externally" shells out to the OS handler for the source file.

### 12.3 Workspace Tree
- Lists `.scad` **or** `.py`, plus `.png`, `.stl`, `.3mf`, `.step`, `.dxf` in the active project.
- Click source → read-only Monaco viewer (the agent edits, not the user).
- Click an export → native file-open dialog.

### 12.4 Capability-driven export buttons
Export buttons are rendered **from the backend capability list** — never hard-coded, never a greyed-out
STEP button on an OpenSCAD project.

```tsx
{backend.exports.map(fmt => (
  <button key={fmt} onClick={() => exportModel(fmt)}>
    Export {fmt.toUpperCase()}
  </button>
))}
```

- OpenSCAD project → **Export STL**, **Export 3MF**
- build123d project → **Export STL**, **Export 3MF**, **Export STEP**, **Export DXF**

---

## 13. Parameter Panel (P2)

When the agent generates a model, the app parses top-level numeric declarations and shows them as editable
sliders/inputs. Changing a value rewrites the source and re-renders **without** invoking the agent — fast,
token-free geometry iteration.

**OpenSCAD** (`.scad`):
```openscad
wall_thickness = 2.5;   // mm
height = 30;
hole_diameter = 5;
```

**build123d** (`.py`) — same idea, Python syntax:
```python
wall_thickness = 2.5   # mm
height = 30
hole_diameter = 5
```

Each backend's `extractParams()` owns its own parser, so the panel UI stays identical.

---

## 14. Settings Screen

| Setting | Description |
|---|---|
| **Detected agents** | List with ✅/❌, binary path, Rescan |
| **Default agent** | Dropdown (Claude Code / OpenCode / Codex) |
| **Modeling backends** *(NEW)* | List with ✅/⚠️/❌ status + missing deps, Rescan |
| **Default backend / output need** *(NEW)* | STL/3MF (openscad) · STEP/DXF (build123d) |
| **OpenSCAD path** | Auto-detected; override field |
| **Python path** *(NEW, build123d)* | Auto-detected; override field |
| **Workspace root** | Default dir for new projects |
| **Skill versions** | Installed OpenSCAD + build123d skill versions, Update |
| **Theme** | Light / Dark / System |

Example Modeling-backends panel:

| Backend | Status | Detail |
|---|---|---|
| OpenSCAD | ✅ | `/opt/homebrew/bin/openscad` |
| build123d | ⚠️ | env OK, missing `f3d` → run `pip install f3d` |

Detection runs on startup and on Rescan — same as agents.

---

## 15. File & Data Model

### 15.1 Workspace structure on disk

```
~/openscad-studio/
  projects/
    {project-id}/
      .studio/
        skills/
          openscad/        ← present if backend = openscad
          build123d/       ← present if backend = build123d
      model_001.scad   |   model_001.py
      model_001_front.png
      model_001_top.png
      model_001_iso.png
      model_002.{scad|py}
      ...
      model_NNN.stl        ← export (on demand)
      model_NNN.step       ← export (build123d only)
```

### 15.2 SQLite schema (Drizzle ORM) — deltas from v0.1 marked

```typescript
// projects table  (+ modeling_backend, output_need)
export const projects = sqliteTable('projects', {
  id:              text('id').primaryKey(),
  name:            text('name').notNull(),
  dir:             text('dir').notNull(),
  agentId:         text('agent_id').notNull(),
  modelingBackend: text('modeling_backend').notNull(),  // NEW 'openscad'|'build123d'
  outputNeed:      text('output_need').notNull(),       // NEW 'print'|'cad'
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt:       integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// sessions table  (unchanged)
export const sessions = sqliteTable('sessions', {
  id:        text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  agentId:   text('agent_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// messages table  (unchanged)
export const messages = sqliteTable('messages', {
  id:        text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  role:      text('role').notNull(),       // 'user'|'assistant'|'tool'
  content:   text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// models table  (+ ext)
export const models = sqliteTable('models', {
  id:        text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  sessionId: text('session_id'),
  filename:  text('filename').notNull(),   // 'model_003.py'
  ext:       text('ext').notNull(),        // NEW '.scad'|'.py'
  version:   integer('version').notNull(),
  prompt:    text('prompt'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// exports table  (NEW — tracks generated STL/3MF/STEP/DXF)
export const exports = sqliteTable('exports', {
  id:        text('id').primaryKey(),
  modelId:   text('model_id').notNull(),
  format:    text('format').notNull(),     // 'stl'|'3mf'|'step'|'dxf'
  path:      text('path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
```

---

## 16. Agent Invocation Examples

### Claude Code
```bash
# New session — skillsDir resolved from project's modeling backend
claude \
  --print \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \
  --add-dir .studio/skills/build123d \
  --allowedTools "Bash,Read,Write,Edit"

# Resume
claude --resume <session_id> --print --output-format stream-json
```
Prompt is written to stdin immediately after spawn, then stdin is closed.

### OpenCode
```bash
opencode serve --hostname 127.0.0.1 --port 4096
opencode run --attach http://127.0.0.1:4096 --agent build \
  "Create a 30mm cylinder with a 5mm central hole"
```

### Codex
```bash
codex --approval-mode auto-edit --quiet \
  "Create a 30mm cylinder with a 5mm central hole. Write it as model_001.py
   in the current directory, then render front/top/iso PNG previews."
```

---

## 17. Modeling Backend Runners (Main Process)

### 17.1 OpenSCAD runner — `main/modeling/openscad.ts`

```typescript
const CAMERAS: Record<CameraPreset, string> = {
  front: '0,0,0,0,0,0,200',
  top:   '0,0,0,90,0,0,200',
  iso:   '0,0,0,45,0,45,200',
}

export const openscad: ModelingBackend = {
  id: 'openscad',
  name: 'OpenSCAD',
  sourceExt: '.scad',
  exports: ['stl', '3mf'],
  skillId: 'openscad',

  async detect() {
    const p = await which('openscad')
    return p ? { available: true, detail: p }
             : { available: false, detail: 'not found', missing: ['openscad'] }
  },

  async render({ modelPath, outDir, cameras, size }) {
    const base = basename(modelPath, '.scad')
    const out: string[] = []
    for (const cam of cameras) {
      const png = join(outDir, `${base}_${cam}.png`)
      await spawn('openscad', [
        '--render', modelPath, '-o', png,
        `--camera=${CAMERAS[cam]}`, `--imgsize=${size[0]},${size[1]}`,
      ])
      out.push(png)
    }
    return out
  },

  async export(modelPath, format) {
    const out = modelPath.replace('.scad', `.${format}`)
    await spawn('openscad', [modelPath, '-o', out])   // STL / 3MF
    return out
  },

  async validate(modelPath) {
    const { code, stderr } = await spawnCapture('openscad', ['--check-parameters', modelPath])
    return { ok: code === 0, errors: stderr.split('\n').filter(Boolean) }
  },

  async extractParams(src) { return parseScadParams(src) },
}
```

### 17.2 build123d runner — `main/modeling/build123d.ts`

```typescript
export const build123d: ModelingBackend = {
  id: 'build123d',
  name: 'build123d',
  sourceExt: '.py',
  exports: ['stl', '3mf', 'step', 'dxf'],
  skillId: 'build123d',

  async detect() {
    const py = await which('python3') ?? await which('python')
    if (!py) return { available: false, detail: 'no python', missing: ['python'] }
    const missing = await probePythonDeps(py, ['build123d', 'f3d'])  // import check
    return missing.length
      ? { available: false, detail: py, missing }
      : { available: true, detail: py }
  },

  async render({ modelPath, outDir, cameras, size }) {
    const base = basename(modelPath, '.py')
    const out: string[] = []
    for (const cam of cameras) {
      const png = join(outDir, `${base}_${cam}.png`)
      await spawn(pythonPath, [
        HARNESS, modelPath, '--camera', cam,
        '--out', png, '--size', `${size[0]}x${size[1]}`,
      ])
      out.push(png)
    }
    return out
  },

  async export(modelPath, format) {
    const out = modelPath.replace('.py', `.${format}`)
    await spawn(pythonPath, [HARNESS, modelPath, '--export', format, '--out', out])
    return out
  },

  async validate(modelPath) {
    // dry-run: import the module, confirm a top-level `result` solid exists
    const { code, stderr } = await spawnCapture(pythonPath, [HARNESS, modelPath, '--check'])
    return { ok: code === 0, errors: stderr.split('\n').filter(Boolean) }
  },

  async extractParams(src) { return parsePyParams(src) },
}
```

### 17.3 Bundled render harness — `skills/build123d/render_harness.py`

Shipped with the app. Provides the render/export/validate operations build123d lacks out of the box.

```python
# render_harness.py  — invoked by the build123d runner
#
#   python render_harness.py <model.py> --camera <front|top|iso> --out <png> --size WxH
#   python render_harness.py <model.py> --export <stl|3mf|step|dxf> --out <path>
#   python render_harness.py <model.py> --check
#
# Contract: the model assigns its final solid to a top-level `result`.
import argparse, importlib.util, sys
from build123d import export_stl, export_step           # + 3mf / dxf helpers

def load_result(path):
    spec = importlib.util.spec_from_file_location("model", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "result"):
        sys.exit("model has no top-level `result` solid")
    return mod.result

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--camera"); ap.add_argument("--export")
    ap.add_argument("--out");    ap.add_argument("--size", default="800x600")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    result = load_result(a.model)
    if a.check:
        return                                   # import + result presence already validated

    if a.export:
        {"stl": export_stl, "step": export_step  # 3mf / dxf wired similarly
         }[a.export](result, a.out)
    elif a.camera:
        # headless PNG via f3d (preferred) or VTK fallback:
        #   1. export result to a temp mesh/brep
        #   2. f3d <tmp> --camera-preset <mapped> --output a.out --resolution <size>
        render_png(result, a.camera, a.out, a.size)

if __name__ == "__main__":
    main()
```

> The harness is the **one new artifact** dual-backend support requires. It isolates every build123d-specific
> rendering concern, keeping the runner thin and the Preview pane backend-agnostic.

---

## 18. IPC Channel Definitions

```typescript
// shared/ipc.ts
export type Channels = {
  // Renderer → Main
  'agent:run':            { prompt: string; projectId: string; sessionId?: string }
  'agent:stop':           { projectId: string }
  'agent:detect':         void
  'backend:detect':       void                                   // NEW
  'model:export':         { modelPath: string; format: ExportFormat }   // generalized
  'model:open':           { modelPath: string }

  // Main → Renderer (streaming events)
  'agent:event':          AgentEvent
  'preview:updated':      { projectId: string; angle: CameraPreset; pngPath: string }
  'workspace:changed':    { projectId: string; files: string[] }
  'agents:detected':      { agents: DetectedAgent[] }
  'backends:detected':    { backends: DetectedBackend[] }         // NEW
}

interface DetectedAgent   { id: string; name: string; path: string; available: boolean }
interface DetectedBackend { id: BackendId; name: string; detail: string;
                            available: boolean; exports: ExportFormat[]; missing?: string[] }
```

Note `openscad:export-stl` from v0.1 is replaced by the generalized `model:export` carrying a format.

---

## 19. Monorepo Structure

```
openscad-studio/
  apps/
    desktop/
      src/
        main/
          index.ts
          agents/
            index.ts          ← adapter pool + detection
            claude-code.ts
            opencode.ts
            codex.ts
          modeling/           ← NEW: modeling backend pool
            index.ts          ← backend registry + detection + selection
            openscad.ts
            build123d.ts
          workspace.ts
          db/
            schema.ts
            migrations/
        renderer/
          components/
            Chat/
            Preview/
            WorkspaceTree/
            ParameterPanel/
            ExportBar/         ← NEW: capability-driven export buttons
            NewProjectDialog/  ← NEW: output-need → backend selection
            Settings/
          stores/
            agent.store.ts
            backend.store.ts   ← NEW
            project.store.ts
            session.store.ts
          App.tsx
    shared/
      ipc.ts
      types.ts                 ← + BackendId, ExportFormat, ModelingBackend
  skills/
    openscad/                  ← OpenSCAD skill
    build123d/                 ← build123d skill + render_harness.py
  package.json                 ← Bun workspaces
  electron-builder.yml
  drizzle.config.ts
```

---

## 20. Non-Goals & Known Risks

| Risk | Mitigation |
|---|---|
| build123d needs Python + OCP + f3d — heavier than one binary | Detect on startup; clear per-dep missing list; block project creation until satisfied; consider bundling a portable env in v1 |
| build123d has no built-in PNG renderer | Bundle `render_harness.py` (f3d preferred, VTK fallback) — §17.3 |
| build123d model has no discoverable top-level solid | Skill enforces `result = ...` convention; `validate()` fails fast with a clear message |
| OpenCode non-interactive hangs on permission prompts | `--agent build` / custom `allowAll`; kill on timeout |
| Codex has no structured event stream | Parse as plain text; show raw streaming |
| Claude Code PATH not found (minimal PATH in app) | Scan `/usr/local/bin`, `/opt/homebrew/bin`, npm global; Rescan button |
| OpenSCAD or Python not installed | First-launch setup screen with per-platform, per-backend install instructions |
| `--add-dir` missing on older Claude Code | Capability detection; fallback: write skill into a temp `CLAUDE.md` |
| Two skills to maintain | Versioned independently in Settings; both bundled offline |
| Mixed export formats per project | `exports` capability list is the single source of truth; UI never offers unsupported formats |

---

## 21. Build & Distribution

- **Dev:** `bun dev` — Vite + Electron in watch mode.
- **Build:** `bun build` → `electron-builder` → `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux).
- **Skills:** both `openscad/` and `build123d/` (incl. `render_harness.py`) bundled in the app resources.
- **Signing:** standard Electron codesign; not required for local dev.
- **Auto-update:** optional in v1 — out of scope for v0.x.

---

## 22. Open Questions

1. **App name** — "OpenSCAD Studio" is now too narrow given build123d support. Rename before public release?
2. **Bundle Python for build123d?** Detecting the user's env is simplest; bundling a portable Python + OCP + f3d
   (à la `build123d-portable`) gives a one-click experience at the cost of installer size. Proposal: detect in
   v0.x, offer a bundled env download in v1.
3. **Renderer choice for build123d** — f3d (lighter, CLI-friendly) vs VTK (via `cadquery-png-plugin`, heavier).
   Start with f3d; keep VTK as fallback.
4. **Third backend (CadQuery)?** Same `ModelingBackend` interface — could be added without architectural change
   if there's demand.
5. **Per-project backend is fixed.** Should switching backends mid-project be allowed (re-skilling + source
   migration)? Likely no for v0.x — start a new project instead.
6. **Monaco read-only vs editable** — exposing source for hand-editing undermines "agent writes everything".
   Keep read-only for v0.x; revisit if requested.
7. **Windows Python detection** — mirror the Claude Code `%APPDATA%\npm` lookup logic for `python`/`py` launcher.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Agent backend** | The local CLI AI that runs the loop (Claude Code / OpenCode / Codex) |
| **Modeling backend** | The CAD engine the AI targets (OpenSCAD / build123d) |
| **CSG** | Constructive Solid Geometry — booleans on primitives (OpenSCAD/CGAL) |
| **B-rep** | Boundary representation — precise surface/solid model (OpenCascade) |
| **Skill** | Curated guidance injected into the agent for a given modeling backend |
| **Harness** | Bundled Python helper giving build123d its render/export/validate CLI |
| **Capability list** | A backend's `exports[]` — the single source of truth for the export UI |

## Appendix B — References

- OpenSCAD vs FreeCAD/Python kernels (PLOS One): https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0225795
- CadQuery introduction (kernel comparison): https://cadquery.readthedocs.io/en/latest/intro.html
- build123d (refactor of CadQuery over OpenCascade): https://github.com/gumyr/build123d
- cadquery-png-plugin (VTK PNG export): https://pypi.org/project/cadquery-png-plugin/
- awesome-build123d (f3d render, portable env, viewers): https://github.com/phillipthelen/awesome-build123d
- awesome-cadquery (cq-cli, ecosystem): https://github.com/CadQuery/awesome-cadquery

---

*End of specification v0.2*
