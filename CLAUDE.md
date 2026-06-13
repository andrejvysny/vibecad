# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**VibeCAD** — local-first, agent-native desktop app for 3D parametric CAD. Wraps Claude Code / OpenCode / Codex (agent axis) over OpenSCAD or build123d (modeling axis). Full spec: `openscad-studio-spec-v0.2.md`. (Product name "VibeCAD" but db/env use the `vibecad`/`VIBECAD` prefix; legacy `studio`/`openscad-studio` names also linger — the project root on disk is `~/openscad-studio/projects/<id>`, the file protocol is `studio://`, and per-project skills copy to `<dir>/.studio/skills/<backend>`.)

## Commands

npm workspaces (root delegates to `electron` + `renderer`). Despite `bunfig.toml`, all scripts run via npm/node — use **npm**, not bun.

```bash
npm run setup        # npm install
npm run dev:desktop  # concurrently: renderer (vite) + electron tsup --watch + electron (waits on :1420)
npm run dev:renderer # vite only
npm run build        # rebuild native deps → renderer vite build → electron-builder (.dmg/.exe/.AppImage)
npm run typecheck    # tsc --noEmit across both workspaces
npm run test         # vitest run (tests/*.test.ts, node env, @shared alias)
npm run db:generate  # drizzle-kit generate (migrations → electron/src/main/db/migrations)
npm run db:push      # drizzle-kit push
npm run db:studio    # drizzle-kit studio
```

Per-workspace: `npm run <script> --workspace electron|renderer` (e.g. `make:mac`, `make:win`, `make:linux`). Tests live in root `tests/` and exercise pure logic only (`extractParams`, `pickBackend`, `parseEvent`, `preview`) — no Electron/DB harness. Run one file with `npx vitest run tests/<name>.test.ts`.

**Native-deps gotcha:** `better-sqlite3` is a native module rebuilt for Electron's ABI by `scripts/ensure-electron-native-deps.mjs`, which runs before `dev:desktop`, `build`, `start`, and `package`. If SQLite throws `NODE_MODULE_VERSION` errors, run that script.

## Stack

- **Electron 41** main/preload bundled by **tsup** (CJS, `node22`), **React 19** + **Zustand** renderer bundled by **Vite 7** + **Tailwind v4**.
- Renderer 3D: **three.js** (r0.169) + **react-resizable-panels** + **opencascade.js** (OCCT WASM, STEP→mesh in-browser).
- **better-sqlite3 + Drizzle ORM** (sqlite). `initDb()` opens WAL + `foreign_keys=ON` and runs migrations on boot (silently skipped if the migrations folder is absent — generate them first).
- DB path: `VIBECAD_DB_PATH` env, else `app.getPath("userData")/vibecad.sqlite`.
- **Zod 4** for runtime validation (shared dep).
- Agent + modeling runners spawn external CLIs via `child_process` (`spawn`/`execFile`); nothing is bundled — binaries are detected on the user's `PATH`.

## Layout

```
electron/src/
  main/
    index.ts         # app boot, BrowserWindow, CSP, studio:// protocol, thin ipcMain handlers
    window.ts        # mainWindow holder: setMainWindow/getMainWindow/sendToRenderer (no cycles)
    agent-run.ts     # runAgentTurn → self-repair/escalate/vision loop, executeTurn, workflow runner
    preview.ts       # latestModel, produceMesh, exportPreviewMesh, renderSnapshots, renderLatest
    repair/          # gates.ts (runGateChain), policy.ts (decideNextAction/classifyDiagnostics/isEnvFailure), prompts.ts (pure)
    diagnostics/     # stl-analyzer.ts (pure binary/ASCII STL geom), openscad-stderr.ts, brep.ts (Zod)
    projects.ts      # project lifecycle (create/list/rename/delete + skill copy into project)
    chat.ts          # session/message persistence (messages.kind: chat|repair|vision); resume id mgmt
    workspace.ts     # fs.watch per project dir → workspace:changed
    paths.ts         # getSkillsDir/getSkillsBase (resolves bundled skills/ in dev vs packaged)
    spawn-env.ts     # cleanSpawnEnv() — strips macOS GUI vars so spawned CLIs run headless
    agents/          # AgentAdapter per CLI (claude-code, opencode, codex) + index registry
    modeling/        # ModelingBackend per engine + param-comments.ts (shared classify/parseComment) + index
    db/{schema,index}.ts + migrations/
  preload/index.ts   # contextBridge → window.api (the ONLY renderer↔main surface)
renderer/src/
  App.tsx            # 3-panel shell; subscribes to push events
  components/        # Chat, Preview/, WorkspaceTree, ExportBar, NewProjectDialog, Settings,
                     #   ProjectSwitcher, SourceViewer, ui/ (cn-based primitives)
  components/Preview/# viewer.ts + viewerThree.ts (three.js scene) + viewerQuality.ts + ParamPanel.tsx
  lib/               # loadStep.ts (opencascade.js OCCT WASM → three.js geom), studio.ts, cn.ts
  stores/            # agent, backend, project, session, view, viewport, preview (Zustand)
shared/              # ipc.ts (payload TYPES) + types.ts (interfaces, enums) + backend-select.ts
                     #   (pickBackend from output-need) — imported by both sides
skills/{openscad,build123d}/   # SKILL.md (+ build123d render_harness.py)
```

Path aliases: `@shared` → `shared/` (tsup + vite), `@` → `renderer/src/` (vite only). The **main process imports `shared/` via relative paths** (`../../../shared/...`), not the alias.

## Two orthogonal axes

| Axis             | Options                                                           |
| ---------------- | ----------------------------------------------------------------- |
| Agent backend    | `claude-code` · `opencode` · `codex`                              |
| Modeling backend | `openscad` (.scad, STL/3MF) · `build123d` (.py, STL/3MF/STEP/DXF) |

Any agent drives any backend. The **skill** is the bridge — `getSkillsDir(backendId)` resolves `skills/{backendId}/` and is passed to the agent's working context (`--add-dir` for Claude Code). Backend is a **per-project property** set at creation (output need: `print`→openscad, `cad`→build123d); not changeable mid-project in v0.x.

## Core interfaces (`shared/types.ts`)

```typescript
interface AgentAdapter   { id; name; detect(): Promise<string|null>; spawn(opts): ChildProcess; parseEvent(line): AgentEvent; kill(child) }
interface ModelingBackend{ id; name; sourceExt; exports[]; skillId; detect(); render(); export(); validate(); extractParams() }
```

Add a new agent/backend = implement the interface in `main/agents/` or `main/modeling/`, then register it in that dir's `index.ts` array. Detection runs every adapter's `detect()` concurrently.

`exports[]` on the backend is the **single source of truth** for export buttons — never hard-code format availability in the UI.

## IPC

`window.api` (preload) is the only bridge — renderer never touches `ipcRenderer` directly, and there is no `nodeIntegration`. **Channel-name strings are literals in `main/index.ts` and `preload/index.ts`; `shared/ipc.ts` holds only the payload _types_** (the spec's claim that all channel names live there is not yet true — keep the two sides in sync by hand).

- Renderer→Main (`invoke`/`handle`): agent (`agent:detect`, `agent:run`, `agent:stop`), chat (`chat:history`, `chat:pick-images`, `chat:save-attachment`), backend (`backend:detect`), model (`model:export`, `model:extract-params`, `model:set-param`, `model:preview-mesh`, `model:read`, `model:import-step`), `shell:reveal`, project (`project:create`/`list`/`open`/`rename`/`set-agent`/`set-model`/`delete`), `app:get-versions`, `window:set-overlay-theme`.
- Main→Renderer (`send`/`on`): `agent:event` (per stdout line via `adapter.parseEvent`), `workspace:changed` (fs.watch), `preview:mesh-ready` `{projectId, meshPath}` and `preview:error` `{projectId, message}`, `turn:status` `{projectId, phase, attempt?, …}` (the accuracy loop's live phase: validating/repairing/escalating/vision/ok/failed → renderer status chip), and `preview:updated` `{projectId, angle, pngPath}` (now **live** — emitted per snapshot by `renderSnapshots`; revives the formerly-dead channel).

`agent:run` loads the project row to resolve agent + backend + working dir, spawns the adapter, persists the turn via `chat.ts`, and forwards each stdout line as an `agent:event` until close. Chat history survives reload (sessions + messages tables; one session per project; `--resume` id reset when the agent is changed).

## Rendering / preview reality

The main process **exports the preview mesh itself**, headlessly (no GL → no OpenSCAD GUI crash, see `spawn-env.ts`). Two paths: (1) the one-off IPC `exportPreviewMesh()` (`model:preview-mesh`, a `set-param` edit); (2) the **accuracy loop** in `agent-run.ts` — after a model-producing turn, `runGateChain()` validates → exports (the export gate's `produceMesh` artifact is reused, no double export) → diagnostics; on accept it pushes `preview:mesh-ready`. A failing gate injects up to 2 auto-repair turns + 1 model escalation (`ESCALATION_MODELS`); a passing-after-repair / "Verify"-toggled / final-workflow-step turn triggers a vision pass (`renderSnapshots` + a Read-the-PNGs turn). All gate checks are deterministic and token-free; tokens are spent only on repair/vision turns.

Per backend:

- **OpenSCAD** → STL. Renderer loads it with three.js `STLLoader`.
- **build123d** → STEP (precise B-rep, used as the preview) **and** STL (always-present print mesh). The renderer tessellates the STEP **client-side** via `lib/loadStep.ts` — the full OpenCascade (OCCT) kernel compiled to WASM (`opencascade.js`, ~50 MB wasm, init once and reused). It extracts faces (winding-corrected) plus true B-rep edge curves, falling back to three.js `EdgesGeometry` if edge extraction fails.

Project files reach the renderer over the custom **`studio://local/<urlencoded-abs-path>`** protocol (registered privileged before `app.ready`) — the renderer's origin can't load `file://` under `webSecurity`. The agent/skill still also writes its own PNGs (per `SKILL.md`), surfaced via the watcher.

## Agent invocation notes

- **Claude Code**: `--print --output-format stream-json --include-partial-messages --verbose`, `--allowedTools Bash,Read,Write,Edit`, `--add-dir <skillsDir>`; prompt via **stdin** then `stdin.end()`; resume via `--resume <sessionId>`. Never set `ANTHROPIC_API_KEY`. `parseEvent` maps `result→done`, `assistant→text_delta`, `tool_use`/`tool_result` passthrough, else `raw`.
- **OpenCode**: prefer `opencode serve` + `--agent build` to avoid cold-boot/permission prompts.
- **Codex**: plain text stream only (no structured events); `--approval-mode auto-edit`.

## build123d specifics

- Requires `python3` + `build123d` + `f3d` on the user's `PATH` (detected on startup, not bundled in v0.x).
- PNG rendering goes through `skills/build123d/render_harness.py` (f3d preferred, VTK fallback).
- Models must assign their final solid to a top-level `result` variable — `validate()` enforces this.

## Security model (main/index.ts)

`contextIsolation: true`, `nodeIntegration: false`, custom CSP (separate dev/prod policies), all permission requests denied, external navigation/window-open routed to `shell.openExternal`. Preserve these when touching window creation.

## Conventions

- TS strict, `noUncheckedIndexedAccess`, `noImplicitOverride`; no `any`. ESM source; bundlers emit CJS for electron.
- IPC channels: `noun:verb`. Functional React + hooks only.
- Code style: see user/global CLAUDE.md (functions <50 lines, comments for "why" only).

## Open questions (spec §22)

1. App name may change before release. 2. Bundle portable Python for build123d in v1? 3. f3d vs VTK for build123d PNG (start f3d). 4. Monaco read-only vs editable (read-only for v0.x).
