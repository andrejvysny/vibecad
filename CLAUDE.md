# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OpenSCAD Studio** — local-first, agent-native desktop app for 3D parametric CAD. Wraps Claude Code / OpenCode / Codex (agent axis) over OpenSCAD or build123d (modeling axis). Full spec: `openscad-studio-spec-v0.2.md`. (Product name "OpenSCAD Studio" but db/env use the `opencad`/`OPENCAD` prefix.)

## Commands

npm workspaces (root delegates to `electron` + `renderer`). Despite `bunfig.toml`, all scripts run via npm/node — use **npm**, not bun.

```bash
npm run setup        # npm install
npm run dev:desktop  # concurrently: renderer (vite) + electron tsup --watch + electron (waits on :1420)
npm run dev:renderer # vite only
npm run build        # rebuild native deps → renderer vite build → electron-builder (.dmg/.exe/.AppImage)
npm run typecheck    # tsc --noEmit across both workspaces
npm run db:generate  # drizzle-kit generate (migrations → electron/src/main/db/migrations)
npm run db:push      # drizzle-kit push
npm run db:studio    # drizzle-kit studio
```

Per-workspace: `npm run <script> --workspace electron|renderer` (e.g. `make:mac`, `make:win`, `make:linux`). No test runner is wired yet (`bun test` in spec is aspirational).

**Native-deps gotcha:** `better-sqlite3` is a native module rebuilt for Electron's ABI by `scripts/ensure-electron-native-deps.mjs`, which runs before `dev:desktop`, `build`, `start`, and `package`. If SQLite throws `NODE_MODULE_VERSION` errors, run that script.

## Stack

- **Electron 41** main/preload bundled by **tsup** (CJS, `node22`), **React 19** + **Zustand** renderer bundled by **Vite 7** + **Tailwind v4**.
- **better-sqlite3 + Drizzle ORM** (sqlite). `initDb()` opens WAL + `foreign_keys=ON` and runs migrations on boot (silently skipped if the migrations folder is absent — generate them first).
- DB path: `OPENCAD_DB_PATH` env, else `app.getPath("userData")/opencad.sqlite`.
- **Zod 4** for runtime validation (shared dep).
- Agent + modeling runners spawn external CLIs via `child_process` (`spawn`/`execFile`); nothing is bundled — binaries are detected on the user's `PATH`.

## Layout

```
electron/src/
  main/
    index.ts         # app boot, BrowserWindow, CSP, ALL ipcMain handlers
    workspace.ts     # fs.watch per project dir → workspace:changed
    agents/          # AgentAdapter per CLI (claude-code, opencode, codex) + index registry
    modeling/        # ModelingBackend per engine (openscad, build123d) + index registry
    db/{schema,index}.ts
  preload/index.ts   # contextBridge → window.api (the ONLY renderer↔main surface)
renderer/src/
  App.tsx            # 3-panel shell; subscribes to push events
  components/        # Chat, Preview, WorkspaceTree, ExportBar, NewProjectDialog, Settings
  stores/            # agent, backend, project, session (Zustand)
shared/              # ipc.ts (payload TYPES) + types.ts (interfaces, enums) — imported by both sides
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

- Renderer→Main (`invoke`/`handle`): `agent:detect`, `agent:run`, `agent:stop`, `backend:detect`, `model:export`, `model:open`, `app:get-versions`, `window:set-overlay-theme`.
- Main→Renderer (`send`/`on`): `agent:event` (streamed per stdout line via `adapter.parseEvent`), `workspace:changed` (fs.watch). `preview:updated` is wired through preload + `App.tsx` but **not yet emitted by main**.

`agent:run` loads the project row to resolve agent + backend + working dir, spawns the adapter, and forwards each stdout line as an `agent:event` until close.

## Rendering / preview reality

`ModelingBackend.render()` exists but is **not wired to any IPC channel**. In the current flow the **agent/skill** runs OpenSCAD itself (per `skills/openscad/SKILL.md`: write `model_NNN.scad`, render front/top/iso PNGs, validate). The app surfaces results by watching the project dir (`workspace.ts` → `workspace:changed`) and re-reading files — it does not call `render()`. Treat `render()`/`preview:updated` as the intended-but-incomplete path.

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
