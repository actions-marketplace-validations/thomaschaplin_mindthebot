import type { Config } from "../config.ts";
import type { ChangedLines, ClassifiedFinding, Finding } from "../types.ts";
import { isNear } from "./patch.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if any reply contains one of the phrases as whole words, case-insensitively. */
export function repliesMatch(finding: Finding, phrases: string[]): boolean {
  if (phrases.length === 0) return false;
  const pattern = new RegExp(`\\b(?:${phrases.map(escapeRegExp).join("|")})\\b`, "i");
  return finding.replies.some((r) => pattern.test(r.body));
}

/**
 * Decide what happened to one AI finding. The first matching rule wins:
 *
 * 1. addressed: code within `proximity` lines of the comment changed afterwards
 * 2. addressed: a human said "fixed"/"good catch" or gave a 👍, and the file changed afterwards
 * 3. dismissed: a 👎, a dismissal reply, or the thread was resolved with no nearby change
 * 4. outdated:  GitHub marked the thread outdated, but no nearby change was found
 * 5. ignored:   none of the above
 *
 * `changes` is undefined when no diff was needed, and null when one couldn't be fetched.
 */
export function classify(
  finding: Finding,
  changes: ChangedLines | null | undefined,
  config: Config,
): ClassifiedFinding {
  const result = (outcome: ClassifiedFinding["outcome"], reason: string): ClassifiedFinding => ({
    ...finding,
    outcome,
    reason,
  });

  const fileLines = finding.path && changes ? changes[finding.path] : undefined;
  const fileChanged = fileLines !== undefined;
  const nearbyChange =
    Array.isArray(fileLines) && finding.line !== null && isNear(fileLines, finding.line, config.proximity);

  if (nearbyChange) {
    return result("addressed", `code within ${config.proximity} lines changed after the comment`);
  }

  const saidAddressed = finding.reactions.up > 0 || repliesMatch(finding, config.addressedPhrases);
  if (saidAddressed && fileChanged) {
    return result("addressed", "reply or 👍 says addressed, and the file changed after the comment");
  }
  if (saidAddressed && changes === null) {
    return result("addressed", "reply or 👍 says addressed (no diff available to confirm)");
  }

  if (finding.reactions.down > 0) return result("dismissed", "👎 reaction");
  if (repliesMatch(finding, config.dismissedPhrases)) return result("dismissed", "reply dismisses the finding");
  if (finding.isResolved) return result("dismissed", "thread resolved with no nearby code change");

  if (finding.isOutdated) return result("outdated", "thread outdated, but no nearby change found");

  return result("ignored", "no reply, reaction, resolution or nearby change");
}
