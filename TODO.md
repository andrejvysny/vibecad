# TODO — UX Redesign

Plan: `~/.claude/plans/act-as-senior-ui-ux-indexed-chipmunk.md`
(Prior "functional end-to-end" phase complete; history in git.)

## Tier 3c — UI primitives (first; reused everywhere)

- [x] cn() helper + ToolbarButton / IconButton / Chip / Segmented

## Tier 1 — Trust & clarity (chat)

- [x] 1a. Collapsible tool-call strip + readable rows (Chat/index.tsx)
- [x] 1a. Reclassify errors: red only on terminal failure, amber for recovered probes
- [x] 1b. Inline render result card ("View in 3D") — agent.store.ts + Chat
- [x] 1c. Composer quick-action chips
- [x] 1d. Contrast + composer icon polish

## Tier 2 — CAD loop

- [x] 2a. IPC: model:extract-params + model:set-param (shared/ipc, main, preload, d.ts)
- [x] 2a. ParamPanel.tsx overlay (both engines, debounced on release, validate guard)
- [x] 2b. viewer.getBounds() + dimension overlay + grid contrast/labels
- [x] 2c. Orientation triad
- [x] 2d. Busy overlay (rendering || agent running)
- [x] 2e. Toolbar regroup + Export ▾ menu + success toast

## Tier 3 — Structure

- [x] 3a. react-resizable-panels: resizable + collapsible panels, persist sizes
- [x] 3b. WorkspaceTree grouped by model base (no version timeline)

## Verify

- [x] npm run typecheck clean (electron + renderer)
- [x] renderer vite build + electron tsup build clean
- [x] npm test: +3 new passing, 0 regressions (3 PRE-EXISTING failures in
      preview.test.ts — stale `deriveLatestPreviews`, unrelated to this work)
- [ ] npm run dev:desktop manual pass (see plan §Verification) — needs display
