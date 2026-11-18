/** Input parsing for the GitHub Action, kept separate from the entry point so it can be tested. */

export const OUTPUTS = ["job-summary", "none"] as const;
export type OutputTarget = (typeof OUTPUTS)[number];

/** Split a comma- or newline-separated input into trimmed, non-empty values. */
export function listInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseOutputs(value: string): OutputTarget[] {
  const targets = listInput(value);
  for (const t of targets) {
    if (!(OUTPUTS as readonly string[]).includes(t)) {
      throw new Error(`Unknown output "${t}". Use ${OUTPUTS.join(", ")}.`);
    }
  }
  return targets as OutputTarget[];
}
