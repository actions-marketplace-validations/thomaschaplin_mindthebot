/** A human reply in a review thread, after the bot's opening comment. */
export interface Reply {
  author: string;
  body: string;
  createdAt: string;
}

/** One inline comment from an AI reviewer: the first comment of a review thread. */
export interface Finding {
  repo: string;
  pr: number;
  bot: string;
  commentId: number;
  url: string;
  createdAt: string;
  body: string;
  path: string | null;
  /** Line in the file at `commitOid` that the comment points at. */
  line: number | null;
  /** The commit the comment was made against. */
  commitOid: string | null;
  isResolved: boolean;
  isOutdated: boolean;
  reactions: { up: number; down: number };
  replies: Reply[];
}

/** A bot comment that isn't tied to a line: a review body or a PR conversation comment. */
export interface SummaryComment {
  bot: string;
  createdAt: string;
}

export interface PullRequestRecord {
  repo: string;
  number: number;
  url: string;
  createdAt: string;
  mergedAt: string;
  headOid: string;
  findings: Finding[];
  summaries: SummaryComment[];
}

/**
 * Lines changed after a comment, keyed by file path, in the coordinates of the
 * commented commit. `null` means the file changed but no patch was available.
 */
export type ChangedLines = Record<string, number[] | null>;

export type Outcome = "addressed" | "dismissed" | "ignored" | "outdated";

export interface ClassifiedFinding extends Finding {
  outcome: Outcome;
  /** Which rule decided the outcome, for transparency and manual checks. */
  reason: string;
}
