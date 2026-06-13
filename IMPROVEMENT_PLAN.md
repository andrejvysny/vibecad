# VibeCAD Accuracy-Stack Implementation Plan

> **Execution target:** Claude Code + Opus 4.8, dynamic workflows.
> **Tracking:** check off tasks in this file as they land. Each phase ends with a verification gate — do not start the next phase until it passes.
> **Conventions:** TS strict, no `any`, functions <50 lines, files <500 lines, comments for "why" only. Never auto-commit.

## Context

VibeCAD delegates modeling to agent CLIs (Claude Code / OpenCode / Codex) writing OpenSCAD (`.scad`) or build123d (`.py`). Audit findings (2026-06-12):

- ✅ Working: param panel loop, preview pipeline (STL / STEP→OCCT WASM), per-project `.studio` context, per-project model picker, session resume.
- ❌ Absent: **self-repair loop** (render/export errors die in the renderer UI, never reach the agent), **vision-in-the-loop** (skills forbid PNGs), **geometry diagnostics** (syntax-only validation), **helper libraries** (no BOSL2), **model escalation**.
- 🐛 Fragile: dead `preview:updated` channel, 120s watchdog resolves cleanly on stall, OCCT WASM init caches failures forever, build123d params carry no constraints to ParamPanel.

This plan implements the accuracy stack (research-backed, see Anthropic Fable 5 CAD demo + cad-khana/openscad-agent/CADAM patterns): **L3 self-repair → L4 diagnostics gates → L5 vision → L0/L1 libraries/skills → L6 escalate-on-failure**, plus the fragile fixes.

**Guiding principle:** deterministic checks first, LLM tokens only where they add accuracy (interpreting a PNG, fixing a reported error). Worst case per user turn = 1 chat + 2 repairs + 1 escalated repair + 1 vision turn; all gates are free.

## Workflow / orchestration notes (for the executing agent)

- Phases are **sequential**. Within a phase, tasks marked ∥ are independent — fan out subagents (or a Workflow pipeline) per ∥ group; everything else is serial.
- After each phase: `npm run typecheck && npm run test`. Phase 1 and 3 also need a manual `npm run dev:desktop` smoke pass.
- Phase 1 step 1 is a **behavior-neutral refactor** — verify typecheck + tests before adding any new logic on top.
- DB migration (Phase 1.4): run `npm run db:generate` after editing `db/schema.ts`; migrations run on boot via `initDb()`.

---

## Architecture

New module tree (splits the 935-line `electron/src/main/index.ts`):

```
electron/src/main/
  agent-run.ts          # NEW — executeTurn() + runAgentTurn() + workflow runner (moved from index.ts:274-460)
  preview.ts            # NEW — latestModel(), exportPreviewMesh(), renderLatest(), renderSnapshots() (moved from index.ts:540-600)
  repair/
    gates.ts            # NEW — runGateChain() (impure: calls backend)
    policy.ts           # NEW — pure: decideNextAction(), classifyDiagnostics(), isEnvFailure()
    prompts.ts          # NEW — pure: buildRepairPrompt(), buildVisionPrompt()
  diagnostics/
    stl-analyzer.ts     # NEW — pure: analyzeStl(buffer) → dependency-free binary/ASCII STL analysis
    openscad-stderr.ts  # NEW — pure: parseOpenscadStderr(text) → {errors, warnings}
  modeling/
    param-comments.ts   # NEW — shared classify()/parseComment() (extracted from openscad.ts)
```

`index.ts` shrinks to: boot, window, protocol, security, thin IPC registrations.

### Shared types (`shared/types.ts` additions)

```typescript
export type GateId = "validate" | "export" | "diagnostics" | "vision";
export type GateStatus = "pass" | "warn" | "fail" | "skipped";

export interface GateResult {
  gate: GateId;
  status: GateStatus;
  errors: string[]; // hard failures → drive repair
  warnings: string[]; // soft context → appended to prompts, never block
  durationMs: number;
}

export interface ModelDiagnostics {
  source: "stl" | "brep";
  bbox: { min: [number, number, number]; max: [number, number, number] };
  volumeMm3: number | null;
  triangles?: number;
  shells: number; // connected components (STL) / shell count (B-rep)
  watertight: boolean | null;
  valid: boolean | null; // BRepCheck validity (build123d only)
  nonManifoldEdges?: number;
}

export interface TurnVerdict {
  modelPath: string | null; // null ⇒ Q&A turn, skip pipeline entirely
  results: GateResult[];
  diagnostics?: ModelDiagnostics;
  meshPath?: string; // export-gate artifact, reused for preview:mesh-ready
  ok: boolean; // every non-skipped gate ≠ "fail"
  envFailure: boolean; // binary missing etc. — never burn agent tokens on this
}

export type RepairAction =
  | { kind: "accept" }
  | { kind: "repair"; attempt: number }
  | { kind: "escalate"; model: string }
  | { kind: "give-up" };

// L6 — no schema change; mirrors AGENT_MODELS presets
export const ESCALATION_MODELS: Record<AgentId, string> = {
  "claude-code": "opus",
  codex: "gpt-5.5",
  opencode: "anthropic/claude-opus-4-1",
};

// L5 — codex is text-only, no image ingestion
export const AGENT_SUPPORTS_VISION: Record<AgentId, boolean> = {
  "claude-code": true,
  opencode: true,
  codex: false,
};
```

### New IPC (`shared/ipc.ts` + preload + App.tsx)

```typescript
export type TurnStatusPayload = {
  projectId: string;
  phase:
    | "validating"
    | "rendering"
    | "repairing"
    | "escalating"
    | "vision"
    | "ok"
    | "failed";
  attempt?: number;
  maxAttempts?: number;
  gate?: GateId;
  message?: string;
};
// channel: "turn:status" (main→renderer); preload: onTurnStatus()
// RunAgentPayload gains verify?: boolean (composer "Verify" toggle, Phase 3)
// ChatMessageRecord gains kind?: "chat" | "repair" | "vision"
```

### Key signatures

```typescript
// agent-run.ts
interface TurnCtx {
  // built once per user turn, reused by repair/vision turns
  project: ProjectRow;
  adapter: AgentAdapter;
  session: SessionRow;
  env: Record<string, string>;
  preamble: string;
  contextDirs: string[];
  abort: AbortSignal; // wired to agent:stop
}
interface ExecOpts {
  modelOverride?: string; // L6
  includePreamble?: boolean; // false on resumed repair turns
  kind: "chat" | "repair" | "vision";
}
async function executeTurn(
  ctx: TurnCtx,
  prompt: string,
  opts: ExecOpts,
): Promise<{ stalled: boolean }>;

// repair/gates.ts
export async function runGateChain(
  backend: ModelingBackend,
  modelPath: string,
): Promise<TurnVerdict>;

// repair/policy.ts (pure — fully unit-testable)
export function decideNextAction(
  verdict: TurnVerdict,
  attempt: number,
  opts: { maxRepairs: number; escalationModel: string; currentModel?: string },
): RepairAction;
export function classifyDiagnostics(
  diag: ModelDiagnostics,
  outputNeed: OutputNeed,
): { errors: string[]; warnings: string[] };
```

---

## Phase 1 — Feedback-loop core (L3 + L6 + watchdog) — PRIORITY 1

### Tasks

- [x] **1.1 Refactor (behavior-neutral):** extract `agent-run.ts` (from `index.ts:274` `runAgentTurn`, workflow runner `:427-460`) and `preview.ts` (`latestModel`:540, `exportPreviewMesh`:554, `renderLatest`:581). `index.ts` keeps thin `ipcMain.handle` registrations. Verify typecheck + tests + dev smoke before continuing. _Done: also added `window.ts` (`setMainWindow`/`getMainWindow`/`sendToRenderer`) so the extracted modules push to the renderer without a cycle back through `index.ts`; `index.ts` no longer owns the `mainWindow` variable. typecheck + 20 tests + tsup bundle all green._
- [x] **1.2** ∥ Add shared types above to `shared/types.ts` / `shared/ipc.ts`; add `onTurnStatus` to `preload/index.ts` + `vite-env.d.ts`; subscribe in `App.tsx`.
- [x] **1.3** Implement `repair/gates.ts` with Gate 1 (validate) + Gate 2 (export); Gate 3 diagnostics returns `{status:"skipped"}` stub. Export gate produces the preview mesh (STL; +STEP for build123d) — **eliminates today's double export** in `renderLatest`.
- [x] **1.4** ∥ DB: `messages.kind` column (`text("kind").notNull().default("chat")`) in `db/schema.ts`; `npm run db:generate`; thread `kind` through `chat.ts` `insertMessage`/`listMessages`.
- [x] **1.5** Implement `repair/policy.ts` + `repair/prompts.ts` (templates below).
- [x] **1.6** Wire the loop into `runAgentTurn` (sequence below), incl. L6 escalation (~20 lines once the loop exists: `modelOverride: ESCALATION_MODELS[agentId]`, skip when `project.agentModel` already equals it). All 3 adapters already forward `opts.model` → `--model` (claude-code.ts:76) and claude-code combines it cleanly with `--resume` (:77).
- [x] **1.7 Watchdog fix** (currently `index.ts:351-369`, moves to `agent-run.ts`): on stall SIGTERM → **SIGKILL after 5s grace**; close handler returns `{stalled:true}` which the loop treats as failure (today a stalled workflow step silently advances); bump the idle timer on parsed `tool_use` events, not just stdout bytes (long OpenSCAD `--render` is legitimately silent >120s); per-project `AbortController` — `agent:stop` aborts the whole loop, checked before every repair attempt.
- [x] **1.8** ∥ Renderer: `turnStatus` field in `agent.store.ts` → status chip under last message ("Validating…", "Repairing… (pass 1/2)", "Escalating to Opus…"); repair-turn user messages rendered **collapsed** ("🔧 Auto-repair pass 1/2", expandable); **fix:** `pushEvent("done")` must stop setting `running:false` (agent.store.ts ~:218) — inner repair turns would re-enable the composer mid-loop; the `run()` `finally` owns `running`.
- [x] **1.9** ∥ Tests: `tests/repairPolicy.test.ts`, `tests/repairPrompt.test.ts` (cases in Test plan).

### Loop sequence (in `runAgentTurn`)

```
1. executeTurn(ctx, userPrompt, {kind:"chat"})          // close-handler no longer calls renderLatest
2. modelPath = await latestModel(project)
   → null ⇒ done (Q&A turn — zero pipeline cost)
3. emit turn:status {phase:"validating"}
   verdict = runGateChain(backend, modelPath)
4. action = decideNextAction(verdict, attempt, …)
   accept    → preview:mesh-ready(verdict.meshPath), turn:status ok, [Phase 3: maybe vision]
   envFailure→ give-up immediately, user-facing error (no tokens on env problems)
   repair    → insertMessage(session, "user", repairPrompt, "repair")
               turn:status {phase:"repairing", attempt, maxAttempts:2}
               executeTurn(ctx, repairPrompt, {kind:"repair", includePreamble:false})
               // resume is automatic: executeTurn re-reads agentSessionId before each spawn
               → goto 2 (attempt++)
   escalate  → same, with modelOverride=ESCALATION_MODELS[agent], turn:status escalating
   give-up   → turn:status failed + preview:error; chat shows final verdict errors
5. agent:run invoke resolves only after the whole loop (workflow steps + running flag stay correct)
```

### Repair prompt template (`prompts.ts`; errors truncated ~2,000 chars; no file contents — agent has session context and Read)

```
The model failed automated validation (repair attempt {n}/{max}).

File: {modelPath}
Failed check: {gate}

Errors:
- {error lines}

Warnings (context only, no fix required):
- {warning lines}

Fix {basename} IN PLACE — do not create a new model_NNN file for a repair.
Re-run the headless validation command from your skill before finishing.
Reply with a one-line summary of what was wrong and what you changed.
```

("in place" matters: `latestModel()` picks the highest `model_NNN`; a new file would orphan the broken one.)

**Preamble edge case:** skip `--append-system-prompt` on resumed repair turns (token save) **iff** `agentSessionId` exists; if the first turn died before the `session` event, repair starts a fresh session → include preamble.

### Verification gate

`npm run typecheck && npm run test`; dev smoke: prompt that produces a deliberately broken `.scad` (e.g. ask for a model, then manually inject a syntax error and trigger a turn) → observe repair chip → fixed model → mesh appears. Stall test: agent turn with CLI hung → SIGKILL after grace, turn reports failure.

---

## Phase 2 — Diagnostics gate (L4, fully deterministic)

### Tasks

- [x] **2.1** ∥ `diagnostics/stl-analyzer.ts` (~150 lines, dependency-free, pure):
  - Parse binary STL (80B header + u32 count + 50B/tri); detect ASCII by `solid`+`facet` prefix.
  - bbox, triangle count, signed-tetrahedron volume.
  - **Watertightness:** quantize vertices (e.g. 1e-6 grid), hash undirected edges — every edge used exactly twice in opposite directions; count violations as `nonManifoldEdges`.
  - **Shell count:** union-find over quantized vertices.
  - Covers BOTH backends (both always produce an STL).
- [x] **2.2** ∥ `diagnostics/openscad-stderr.ts` (pure): errors = `/^ERROR:/m`, `No top level geometry to render`, `Current top level object is not a 3D object`; warnings = `/^WARNING:.*(2-manifold|CGAL|mesh)/m` + other `WARNING:` lines. Requires `openscad.ts run()` to return stderr **even on exit 0** (today it discards it — change `run` to return `{code, stderr}` and thread through `export()`).
- [x] **2.3** ∥ `render_harness.py --diagnostics` mode → JSON to stdout (build123d API only, no raw OCP):

```python
def diagnostics(result) -> dict:
    bb = result.bounding_box()
    return {
        "valid": bool(result.is_valid()),     # BRepCheck under the hood
        "volume": float(result.volume),
        "bbox": {"min": [bb.min.X, bb.min.Y, bb.min.Z],
                 "max": [bb.max.X, bb.max.Y, bb.max.Z]},
        "solids": len(result.solids()),
        "shells": len(result.shells()),
    }
```

Parse in main with **Zod** (already a dep); malformed output degrades to `{status:"skipped"}`, never crashes the loop. Min-wall-thickness: deferred behind a future `--thorough` flag.

- [x] **2.4** `classifyDiagnostics` in `policy.ts` per severity table below; wire Gate 3 in `gates.ts`.
- [x] **2.5** ∥ Tests: `tests/stlAnalyzer.test.ts`, `tests/openscadStderr.test.ts`, `tests/diagnostics.test.ts`.

> **Phase 2 deviations:** (1) `runGateChain(backend, modelPath, outputNeed)` gained the `outputNeed` arg — Gate 3 needs it for the print-vs-cad severity split. (2) Backend-specific diagnostics are surfaced via two **optional** `ModelingBackend` methods: `exportWithLog?` (OpenSCAD — captures export stderr even on exit 0) and `brepDiagnostics?` (build123d — OCCT BRepCheck via the harness). `produceMesh` now returns `{meshPath, stderr}`. (3) The harness B-rep JSON parser was extracted to a pure `diagnostics/brep.ts` (Zod) so it's unit-testable without importing Electron. Gate 3 in `gates.ts` combines `analyzeStl` (both backends) + `brepDiagnostics` (build123d) + `parseOpenscadStderr` (OpenSCAD). Gate: typecheck + 53 tests green.

### Severity table (hard = drives repair; warn = prompt context only)

| Condition                                                                   | Severity                             |
| --------------------------------------------------------------------------- | ------------------------------------ |
| export failed / 0 triangles / volume ≤ 0 / degenerate bbox axis             | HARD                                 |
| not watertight (openscad, `outputNeed:"print"`) / `valid:false` (build123d) | HARD                                 |
| non-manifold edges > 0                                                      | HARD (print) / WARN (cad)            |
| shells > 1                                                                  | WARN (multi-part can be intentional) |
| bbox max dimension > 1000 mm                                                | WARN (probable unit error)           |
| CGAL/stderr warnings                                                        | WARN                                 |

---

## Phase 3 — Vision-in-the-loop (L5)

Main renders PNGs; the agent only **Reads** them. Never let the agent render its own.

### Tasks

- [x] **3.1** Fix OpenSCAD cameras (`openscad.ts:18-22` presets are wrong — fixed dist=200, "front" rot is actually top):

```typescript
// openscad --camera=tx,ty,tz,rotX,rotY,rotZ,dist  + --viewall --autocenter (auto-fit any size)
const CAMERA_ARGS: Record<CameraPreset, string> = {
  front: "0,0,0,90,0,0,0",
  top: "0,0,0,0,0,0,0",
  iso: "0,0,0,55,0,25,0",
};
// invocation: $OPENSCAD model.scad -o model_003_iso.png --imgsize=800,600 \
//   --camera=0,0,0,55,0,25,0 --viewall --autocenter --projection=perspective
```

- [x] **3.2** ∥ Fix `render_harness.py` cameras: replace fixed `--camera-position 200,…` with f3d auto-fit directions: `--camera-direction=-1,-1,-1` (iso), `-1,0,0` (front), `0,0,-1` (top); drop position/focal.
- [x] **3.3** `renderSnapshots(project, modelPath)` in `preview.ts` calling existing `backend.render({cameras, size:[800,600]})` (implemented for both backends, currently never called by main). Emit **`preview:updated {projectId, angle, pngPath}`** per snapshot — revives the dead channel; renderer subscribes in `App.tsx` (thumbnails: `agent.store.captureResult` already looks for `${base}_${angle}.png`).
- [x] **3.4** Vision policy + prompt (below); composer "Verify" toggle → `RunAgentPayload.verify`; gate by `AGENT_SUPPORTS_VISION` and f3d presence (absent → `skipped`, never `fail`).
- [x] **3.5** Vision turn re-enters the gate chain if it edits the file; counts toward the same attempt budget; hard cap **1 vision round** per user turn.

### Token-conserving vision policy

| Trigger                    | Snapshots (free)   | Vision turn (tokens)                           |
| -------------------------- | ------------------ | ---------------------------------------------- |
| every successful turn      | iso only           | no                                             |
| gates pass after ≥1 repair | iso/front/top      | **yes** (model was just broken — sanity-check) |
| user "Verify" toggle       | iso/front/top      | yes                                            |
| final workflow step        | iso/front/top      | yes                                            |
| codex agent / f3d missing  | iso where possible | never                                          |

### Vision prompt

```
All automated geometry checks passed. The app rendered these views of {basename}:
- {iso png path}
- {front png path}
- {top png path}
Read each image and compare against the user's request in this conversation.
If the geometry is wrong (missing/extra features, wrong proportions or orientation),
fix the model in place and re-validate. If it matches, reply exactly: VERIFIED — <one line>.
```

---

## Phase 4 — Libraries + skills (L0/L1) + param pipeline

### Tasks

- [~] **4.1** Vendor **BOSL2** at `skills/openscad/lib/BOSL2` (git submodule pinned to a commit known-good on OpenSCAD 2021.01; fall back to vendored snapshot if submodules complicate packaging — verify electron-builder `extraResources` globs include `skills/`). Inject `OPENSCADPATH=<skillsBase>/openscad/lib` in **both**: `openscad.ts` spawns (`cleanSpawnEnv({OPENSCADPATH})`) and the agent env in `runAgentTurn` (next to `OPENSCAD_BIN`) so the agent's own `--export-format=echo` check resolves `include <BOSL2/std.scad>`. _**Code-wired, vendoring deferred to user.** `configureOpenscadPath()` in `index.ts` prepends `<skillsBase>/openscad/lib` to `OPENSCADPATH`; `cleanSpawnEnv` spreads `process.env`, so this reaches OpenSCAD's own exports AND every agent spawn (simpler than touching both call sites). Verified `electron-builder.cjs` already ships `skills/` via `extraResources`. The actual `git clone` of BOSL2 was blocked by the auto-mode safety classifier (untrusted external code that would execute during exports) — `skills/openscad/lib/README.md` documents the one-time vendor command; SKILL.md tells the agent to fall back to primitives if `include <BOSL2/std.scad>` doesn't resolve._
- [x] **4.2** ∥ `skills/openscad/SKILL.md` rewrite:
  - NEW "BOSL2" section: `include <BOSL2/std.scad>`; prefer `cuboid/cyl/prismoid` + `anchor/spin/orient` + `attach()`; `threading.scad`/`gears.scad` for screws/gears; never hand-roll rounding.
  - REPLACE the "no PNGs" rule with: "Do NOT render PNGs or launch the GUI. **The app renders snapshot PNGs itself** and gives you their paths when visual verification is requested — Read those."
  - NEW: "On an automated repair message, fix the named file in place; never bump NNN for a repair."
  - Keep the headless-validate rule (agent-side mirror of Gate 1).
- [x] **4.3** ∥ `skills/build123d/SKILL.md` rewrite: house style — top-level annotated params (below), `result` required, **no raw `OCP.*` imports**, `from helpers import …` allowed, all dimensions parametric; same PNG/repair rules.

```python
width = 60.0     # PARAM [20:200] Width in mm
style = "round"  # PARAM [round, square] Corner style
```

- [x] **4.4** ∥ New `skills/build123d/helpers.py`: small vetted set (`rounded_box`, `counterbored_hole`, `assert_solid(result)`); `render_harness.py` adds `sys.path.insert(0, str(Path(__file__).parent))` so helpers resolve for both agent `--check` and app exports.
- [x] **4.5** Extract `classify()`/`parseComment()` from `openscad.ts` into `modeling/param-comments.ts`; build123d `extractParams` (currently parses **no** comments) reuses them on `# PARAM [..] desc` trailing comments; extend regex to strings/booleans; derive `unit` from a `... in mm` description suffix.
- [x] **4.6** ∥ ParamPanel polish: clamp numeric inputs to min/max, show `description` subtext + `unit` suffix, section headers from `// === Section ===`.
- [x] **4.7** ∥ Tests: extend `tests/extractParams.test.ts` (build123d annotations, options, booleans, strings, unit).

---

## Phase 5 — Remaining fragile fix + end-to-end pass

- [x] **5.1** OCCT WASM init (`renderer/src/lib/loadStep.ts:29-34`): wrap factory init in `Promise.race` with 30s timeout; on rejection/timeout reset `ocPromise = null` (retry next attempt) + throw typed `StepViewerInitError`; `Preview/index.tsx` catches → falls back to the always-present `${base}.stl` via STLLoader + toast "STEP viewer unavailable — showing STL".
- [~] **5.2** Manual end-to-end pass on both backends: create project → prompt → break model → watch repair → diagnostics failure case → vision verify → param edit → export.

---

## Test plan (pure-logic vitest, `tests/`, no Electron harness)

| File                             | Key cases                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repairPolicy.test.ts`           | pass→accept; fail@0→repair(1); fail@2→escalate w/ mapped model; fail-after-escalate→give-up; warnings-only→accept; envFailure→give-up immediately; escalation skipped when model already strong |
| `repairPrompt.test.ts`           | path+gate+errors present; 50KB stderr truncated; warnings section conditional; "fix in place" phrasing; attempt counter                                                                         |
| `stlAnalyzer.test.ts`            | hand-built buffers: tetrahedron → watertight/volume/bbox exact; open tri → not watertight + nonManifoldEdges; two disjoint cubes → shells=2; ASCII parse; garbage → typed error                 |
| `openscadStderr.test.ts`         | CGAL 2-manifold → warn; `ERROR:` → error; "No top level geometry" → error; clean → empty                                                                                                        |
| `diagnostics.test.ts`            | `classifyDiagnostics` severity table (print vs cad); Zod parse incl. malformed → skipped                                                                                                        |
| `extractParams.test.ts` (extend) | build123d `# PARAM [min:max] desc`, options, booleans, strings, unit                                                                                                                            |
| `agentContext.test.ts` (extend)  | preamble omitted iff agentSessionId exists                                                                                                                                                      |

---

## Execution outcome (2026-06-12 → 06-13)

All 5 phases implemented. **Gate: typecheck PASS · 57 tests (20 → 57) · electron + renderer bundles · python compiles.** `index.ts` 935 → ~660 lines. Nothing committed (working tree only).

**Adversarial review** (21-agent workflow over the untested impure code in phases 2–5; every finding independently verified before action): **3 confirmed, all low-severity** — no high/medium correctness bug survived verification.

- ✅ Fixed: ASCII STL parsing now rejects an uneven (truncated-facet) vertex count with `StlParseError` (was silent; binary path was already strict) — `+` test.
- ✅ Fixed: build123d `set-param` preserves the original whitespace before a `# PARAM …` comment instead of collapsing it to 2 spaces (don't reformat the agent's file on an edit).
- ⏹ Declined: "section state leaks to later params" — sticky-until-next-`// === … ===` matches OpenSCAD Customizer semantics (the verifier agreed it's by-design); adding a reset would break legitimate grouping. No change.

**Deferred to user:** (4.1) vendoring BOSL2 — code wired, clone blocked by the safety classifier, command in `skills/openscad/lib/README.md`; (1.x/3.x/5.2) manual `npm run dev:desktop` smoke passes — need the real GUI + agent/OpenSCAD/f3d binaries.

## Risks / open items

- **OpenCode/Codex resume fidelity:** their `parseEvent` never emits `session`/structured `done` → repair works but each repair turn re-reads the file with weaker context. Acceptable v1; note in code.
- **BOSL2 vs OpenSCAD 2021.01:** some modules need dev snapshots — pin a known-good commit, document in SKILL.md.
- **Cost ceiling:** consider a per-project "auto-repair" toggle if users complain (default on).
- **`models` DB table unused:** verdicts/diagnostics could persist there later; out of scope.
- **Packaging:** confirm `skills/openscad/lib/BOSL2` ships in packaged resources (`paths.ts` resolution + electron-builder config).
