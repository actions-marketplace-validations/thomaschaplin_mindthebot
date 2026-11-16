import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const botMatcherSchema = z.object({
  /** Display name. Several matchers can share one name, e.g. two ways Claude can post. */
  name: z.string().min(1),
  /** GitHub login, with or without the `[bot]` suffix. Case-insensitive. */
  login: z.string().min(1),
  /** Optional case-insensitive regex the comment body must match (for shared logins like `github-actions`). */
  bodyPattern: z.string().optional(),
});

export const configSchema = z.object({
  bots: z.array(botMatcherSchema).min(1),
  /** How many lines either side of the commented line count as "near". */
  proximity: z.number().int().min(0).max(50),
  /**
   * Only count summary-comment items that carry a severity label (e.g. [WARNING], a P1 badge).
   * Bots also cite file:line as evidence for points that aren't issues; this keeps those out.
   */
  summaryRequiresSeverity: z.boolean(),
  addressedPhrases: z.array(z.string()),
  dismissedPhrases: z.array(z.string()),
});

export type BotMatcher = z.infer<typeof botMatcherSchema>;
export type Config = z.infer<typeof configSchema>;

export const defaultConfig: Config = {
  bots: [
    { name: "Claude", login: "claude" },
    // claude-code-action posts as github-actions when run with the default GITHUB_TOKEN.
    { name: "Claude", login: "github-actions", bodyPattern: "claude" },
    { name: "Greptile", login: "greptile-apps" },
    { name: "Copilot", login: "copilot-pull-request-reviewer" },
    { name: "CodeRabbit", login: "coderabbitai" },
    { name: "Cursor Bugbot", login: "cursor" },
    { name: "Cubic", login: "cubic-dev-ai" },
    { name: "Codex", login: "chatgpt-codex-connector" },
    { name: "Gemini", login: "gemini-code-assist" },
  ],
  proximity: 3,
  summaryRequiresSeverity: true,
  addressedPhrases: [
    "fixed",
    "done",
    "good catch",
    "nice catch",
    "addressed",
    "updated",
    "resolved in",
  ],
  dismissedPhrases: [
    "not an issue",
    "false positive",
    "intentional",
    "intended",
    "by design",
    "won't fix",
    "wont fix",
    "wontfix",
    "not relevant",
    "not applicable",
    "this is fine",
    "leaving as is",
    "leave as is",
    "leaving it as is",
    "keeping as is",
    "keep as is",
    "out of scope",
    "known limitation",
    "pre-existing",
  ],
};

/** Load a YAML config file and merge it over the defaults. */
export async function loadConfig(path?: string): Promise<Config> {
  if (!path) return defaultConfig;
  const raw = parse(await readFile(path, "utf8")) ?? {};
  return configSchema.parse({ ...defaultConfig, ...raw });
}
