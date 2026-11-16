/**
 * Pull a severity label out of a review comment. Reviewers mark severity in
 * different ways; this normalises the common ones to lowercase labels.
 *
 * - Greptile: a badge image, e.g. `badges/p1.svg` → "p1"
 * - Tagged text, e.g. `[WARNING]`, `[NOTE]`, `**Critical**` → "warning", "note", "critical"
 * - CodeRabbit: an icon then the label, e.g. `</picture> Major**` or `_🟠 Major_` → "major"
 * - Claude Code Review markers: 🔴 → "important", 🟡 → "nit", 🟣 → "pre-existing"
 */
const TAGS = ["critical", "blocker", "blocking", "high", "error", "warning", "medium", "low", "note", "info", "nit", "suggestion"];

const EMOJI: [string, string][] = [
  ["🔴", "important"],
  ["🟡", "nit"],
  ["🟣", "pre-existing"],
];

const CODERABBIT = /(?:<\/picture>\s*|_(?:🔴|🟠|🟡|🔵|⚪)\s*)(critical|major|minor|trivial|info)(?![a-z])/i;

export function extractSeverity(raw: string): string | null {
  const badge = /badges\/(p\d)\.svg/i.exec(raw);
  if (badge) return badge[1]!.toLowerCase();

  // Some bots open with a large HTML-comment metadata block; skip it.
  const body = raw.replace(/<!--[\s\S]*?-->/g, "").trimStart();
  // Only look near the start, so a word like "error" deep in the explanation doesn't count.
  const rabbit = CODERABBIT.exec(body.slice(0, 600));
  if (rabbit) return rabbit[1]!.toLowerCase();

  const head = body.slice(0, 200);
  const tag = new RegExp(`(?:\\[|\\*\\*)(${TAGS.join("|")})(?:\\]|\\*\\*|:)`, "i").exec(head);
  if (tag) return tag[1]!.toLowerCase();

  for (const [emoji, label] of EMOJI) {
    if (head.trimStart().startsWith(emoji)) return label;
  }
  return null;
}
