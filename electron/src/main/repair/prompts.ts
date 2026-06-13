import { basename } from "node:path";
import type { GateId } from "../../../../shared/types.js";

// Cap the error block so a runaway stderr (e.g. a 50 KB CGAL dump) can't blow up
// the prompt; the agent has the file + Read and only needs the gist.
const MAX_ERRORS_CHARS = 2000;

function truncate(text: string, max = MAX_ERRORS_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}

export interface RepairPromptInput {
  modelPath: string;
  gate: GateId;
  attempt: number;
  maxAttempts: number;
  errors: string[];
  warnings: string[];
}

/**
 * The auto-repair message injected as a follow-up user turn when a model fails a
 * gate. No file contents — the agent has session context + Read. "In place"
 * matters: `latestModel()` picks the highest model_NNN, so a new file would
 * orphan the broken one.
 */
export function buildRepairPrompt(input: RepairPromptInput): string {
  const base = basename(input.modelPath);
  const errors = truncate(input.errors.map((e) => `- ${e}`).join("\n"));
  const warnings = input.warnings.length
    ? `\n\nWarnings (context only, no fix required):\n${input.warnings
        .map((w) => `- ${w}`)
        .join("\n")}`
    : "";
  return `The model failed automated validation (repair attempt ${input.attempt}/${input.maxAttempts}).

File: ${input.modelPath}
Failed check: ${input.gate}

Errors:
${errors}${warnings}

Fix ${base} IN PLACE — do not create a new model_NNN file for a repair.
Re-run the headless validation command from your skill before finishing.
Reply with a one-line summary of what was wrong and what you changed.`;
}

/**
 * The vision-check message: the app already rendered the snapshot PNGs, so the
 * agent only Reads them and compares against the conversation. Never asks the
 * agent to render its own image.
 */
export function buildVisionPrompt(input: {
  modelPath: string;
  pngPaths: string[];
}): string {
  const base = basename(input.modelPath);
  const list = input.pngPaths.map((p) => `- ${p}`).join("\n");
  return `All automated geometry checks passed. The app rendered these views of ${base}:
${list}
Read each image and compare against the user's request in this conversation.
If the geometry is wrong (missing/extra features, wrong proportions or orientation),
fix the model in place and re-validate. If it matches, reply exactly: VERIFIED — <one line>.`;
}
