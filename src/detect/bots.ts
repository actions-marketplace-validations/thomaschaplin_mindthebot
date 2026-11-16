import type { BotMatcher } from "../config.ts";

/** GraphQL returns bot logins without `[bot]`, REST returns them with it. Compare without. */
export function normaliseLogin(login: string): string {
  return login.toLowerCase().replace(/\[bot\]$/, "");
}

/**
 * Return the display name of the AI reviewer that wrote a comment, or null if
 * the author isn't a configured reviewer.
 */
export function detectBot(
  matchers: BotMatcher[],
  login: string | null | undefined,
  body: string,
): string | null {
  if (!login) return null;
  const author = normaliseLogin(login);
  for (const matcher of matchers) {
    if (normaliseLogin(matcher.login) !== author) continue;
    if (matcher.bodyPattern && !new RegExp(matcher.bodyPattern, "i").test(body)) continue;
    return matcher.name;
  }
  return null;
}

/** True if the login belongs to any configured reviewer, regardless of body. */
export function isBotLogin(matchers: BotMatcher[], login: string | null | undefined): boolean {
  if (!login) return false;
  const author = normaliseLogin(login);
  return matchers.some((m) => normaliseLogin(m.login) === author);
}
