import type { Config } from "../config.ts";
import type { Finding } from "../types.ts";
import type { SummaryItem } from "./summary-items.ts";

/** A summary item together with the comment it came from. */
export interface RaisedItem extends SummaryItem {
  bot: string;
  commentId: number;
  url: string;
  deliveredAt: string;
}

export interface CommitInfo {
  oid: string;
  committedDate: string;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

/** Jaccard similarity of the words in two titles. */
export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared);
}

function rangesNear(a: SummaryItem, b: SummaryItem, proximity: number): boolean {
  const aEnd = a.endLine ?? a.line;
  const bEnd = b.endLine ?? b.line;
  return a.line - proximity <= bEnd && b.line - proximity <= aEnd;
}

/** Two items describe the same issue if they're in the same file and either overlap or have similar titles. */
export function sameIssue(a: SummaryItem, b: SummaryItem, proximity: number): boolean {
  if (a.path !== b.path) return false;
  return rangesNear(a, b, proximity) || titleSimilarity(a.title, b.title) >= 0.4;
}

/** The newest commit made at or before a moment: the code the reviewer most likely saw. */
export function commitAt(commits: CommitInfo[], at: string): string | null {
  const time = Date.parse(at);
  let best: CommitInfo | null = null;
  for (const c of commits) {
    const t = Date.parse(c.committedDate);
    if (t <= time && (!best || t >= Date.parse(best.committedDate))) best = c;
  }
  return best?.oid ?? null;
}

/**
 * Turn summary items into findings. Re-reviews often repeat an issue that's
 * still open; those repeats are merged into one finding. The finding keeps the
 * time it was first raised, but is checked against the code at the *latest*
 * review that raised it, because repeating it means it wasn't fixed by then.
 */
export function summaryFindings(
  repo: string,
  pr: number,
  items: RaisedItem[],
  commits: CommitInfo[],
  config: Config,
): Finding[] {
  const sorted = [...items].sort((a, b) => a.deliveredAt.localeCompare(b.deliveredAt));
  const groups: RaisedItem[][] = [];
  for (const item of sorted) {
    const group = groups.find((g) => g[0]!.bot === item.bot && sameIssue(g[g.length - 1]!, item, config.proximity));
    if (group) group.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => {
    const first = group[0]!;
    const latest = group[group.length - 1]!;
    return {
      repo,
      pr,
      bot: first.bot,
      source: "summary",
      severity: first.severity,
      commentId: first.commentId,
      url: first.url,
      createdAt: first.deliveredAt,
      body: first.text,
      path: latest.path,
      line: latest.line,
      endLine: latest.endLine,
      commitOid: commitAt(commits, latest.deliveredAt),
      isResolved: false,
      isOutdated: false,
      reactions: { up: 0, down: 0 },
      replies: [],
      repeats: group.length - 1,
    } satisfies Finding;
  });
}
