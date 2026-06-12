# TODO — Make OpenSCAD Studio Functional End-to-End

Plan: `~/.claude/plans/act-as-senior-software-lovely-graham.md`

## Phase 0 — VCS + tests

- [x] git init + initial commit
- [x] vitest setup (root) + `npm test`
- [x] `pickBackend` shared util + test (used in NewProjectDialog)
- [x] preview-derivation pure helper + test
- [x] claude-code parseEvent test, openscad extractParams test

## Phase A — Migrations

- [x] `npm run db:generate` (0000_motionless_ironclad.sql)
- [x] surface migration errors in db/index.ts (fail loud if folder missing)
- [x] ship migrations in electron-builder extraResources

## Phase B — Project lifecycle

- [x] paths.ts (fixed buggy skills path) + projects.ts (create/list/get, skills copy, availability check)
- [x] project:create/list/open IPC
- [x] shared/ipc.ts payload types
- [x] preload + ambient window.api type
- [x] project.store loadProjects/createProject
- [x] App.tsx nav + mount NewProjectDialog + Settings

## Phase C — Watching + previews

- [x] setActiveWatch on create/open; removed watchWorkspace no-op
- [x] setFiles derives previews (latest model_NNN)
- [x] model:render IPC emits preview:updated + Re-render button

## Phase D — Stop

- [x] registerActive(projectId, child) in agent:run

## Verify

- [x] typecheck green (electron + renderer)
- [x] test green (11/11)
- [x] electron tsup + renderer vite builds clean
- [x] migration creates all 5 tables (verified against better-sqlite3)
- [ ] manual end-to-end run (needs display + claude/openscad on PATH)

## Follow-ups (out of scope this round)

- Parameter panel (P2) — consumes model:render + extractParams
- Session/message/model persistence + Claude --resume
- Bonus fix landed: corrected getSkillsDir/getHarnessPath (were resolving
  outside the repo — latent bugs, never exercised before)
