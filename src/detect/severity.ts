/**
 * Pull a severity label out of a review comment. Reviewers mark severity in
 * different ways; this normalises the common ones to lowercase labels.
 *
 * - Greptile: a badge image, e.g. `badges/p1.svg` → "p1"
 * - Tagged text, e.g. `[WARNING]`, `[NOTE]`, `**Critical**` → "warning", "note", "critical"
 * - Claude Code Review markers: 🔴 → "important", 🟡 → "nit", 🟣 → "pre-existing"
 */
const TAGS = ["critical", "blocker", "blocking", "high", "error", "warning", "medium", "low", "note", "info", "nit", "suggestion"];

const EMOJI: [string, string][] = [
  ["🔴", "important"],
  ["🟡", "nit"],
  ["🟣", "pre-existing"],
];

export function extractSeverity(body: string): string | null {
  const badge = /badges\/(p\d)\.svg/i.exec(body);
  if (badge) return badge[1]!.toLowerCase();

  // Only look near the start, so a word like "error" deep in the explanation doesn't count.
  const head = body.slice(0, 200);
  const tag = new RegExp(`(?:\\[|\\*\\*)(${TAGS.join("|")})(?:\\]|\\*\\*|:)`, "i").exec(head);
  if (tag) return tag[1]!.toLowerCase();

  for (const [emoji, label] of EMOJI) {
    if (head.trimStart().startsWith(emoji)) return label;
  }
  return null;
}
