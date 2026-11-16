import type { ClassifiedFinding, PullRequestRecord } from "../types.ts";
import { minutesBetween } from "../util/duration.ts";
import { median, percentile, ratio } from "../util/stats.ts";

export interface BotStats {
  bot: string;
  /** Repo name, or "*" for all repos combined. */
  repo: string;
  /** PRs where this bot left at least one comment of any kind. */
  prsReviewed: number;
  findings: number;
  addressed: number;
  dismissed: number;
  ignored: number;
  outdated: number;
  addressedRate: number;
  dismissedRate: number;
  ignoredRate: number;
  findingsPerPr: number;
  summaryComments: number;
  /** Median minutes from PR opened to this bot's first comment. */
  medianFirstCommentMinutes: number | null;
}

export interface MergeTimes {
  prs: number;
  medianHours: number | null;
  p75Hours: number | null;
}

export interface Ledger {
  generatedAt: string;
  since: string;
  repos: string[];
  prsAnalysed: number;
  prsWithAi: number;
  timeToMerge: { withAiFindings: MergeTimes; withoutAiFindings: MergeTimes };
  byBot: BotStats[];
  byRepoAndBot: BotStats[];
  topDismissedFiles: { repo: string; path: string; dismissed: number }[];
  findings: ClassifiedFinding[];
}

function mergeTimes(prs: PullRequestRecord[]): MergeTimes {
  const hours = prs.map((pr) => minutesBetween(pr.createdAt, pr.mergedAt) / 60);
  return { prs: prs.length, medianHours: median(hours), p75Hours: percentile(hours, 75) };
}

function botStats(
  bot: string,
  repo: string,
  prs: PullRequestRecord[],
  findings: ClassifiedFinding[],
): BotStats {
  const mine = findings.filter((f) => f.bot === bot);
  const count = (outcome: ClassifiedFinding["outcome"]) => mine.filter((f) => f.outcome === outcome).length;

  const firstCommentMinutes: number[] = [];
  let prsReviewed = 0;
  let summaryComments = 0;
  for (const pr of prs) {
    const times = [
      ...pr.findings.filter((f) => f.bot === bot).map((f) => f.createdAt),
      ...pr.summaries.filter((s) => s.bot === bot).map((s) => s.createdAt),
    ].sort();
    summaryComments += pr.summaries.filter((s) => s.bot === bot).length;
    if (times.length === 0) continue;
    prsReviewed += 1;
    firstCommentMinutes.push(minutesBetween(pr.createdAt, times[0]!));
  }

  const addressed = count("addressed");
  const dismissed = count("dismissed");
  const ignored = count("ignored");
  return {
    bot,
    repo,
    prsReviewed,
    findings: mine.length,
    addressed,
    dismissed,
    ignored,
    outdated: count("outdated"),
    addressedRate: ratio(addressed, mine.length),
    dismissedRate: ratio(dismissed, mine.length),
    ignoredRate: ratio(ignored, mine.length),
    findingsPerPr: ratio(mine.length, prsReviewed),
    summaryComments,
    medianFirstCommentMinutes: median(firstCommentMinutes),
  };
}

export function buildLedger(
  prs: PullRequestRecord[],
  findings: ClassifiedFinding[],
  options: { since: string; repos: string[]; now?: Date },
): Ledger {
  const bots = [
    ...new Set([...prs.flatMap((pr) => pr.findings.map((f) => f.bot)), ...prs.flatMap((pr) => pr.summaries.map((s) => s.bot))]),
  ].sort();

  const byBot = bots.map((bot) => botStats(bot, "*", prs, findings));
  const byRepoAndBot = options.repos.flatMap((repo) => {
    const repoPrs = prs.filter((pr) => pr.repo === repo);
    const repoFindings = findings.filter((f) => f.repo === repo);
    return bots
      .map((bot) => botStats(bot, repo, repoPrs, repoFindings))
      .filter((s) => s.prsReviewed > 0);
  });

  const dismissedByFile = new Map<string, { repo: string; path: string; dismissed: number }>();
  for (const f of findings) {
    if (f.outcome !== "dismissed" || !f.path) continue;
    const key = `${f.repo}:${f.path}`;
    const entry = dismissedByFile.get(key) ?? { repo: f.repo, path: f.path, dismissed: 0 };
    entry.dismissed += 1;
    dismissedByFile.set(key, entry);
  }

  const withAi = prs.filter((pr) => pr.findings.length > 0);
  const withoutAi = prs.filter((pr) => pr.findings.length === 0);

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    since: options.since,
    repos: options.repos,
    prsAnalysed: prs.length,
    prsWithAi: prs.filter((pr) => pr.findings.length > 0 || pr.summaries.length > 0).length,
    timeToMerge: { withAiFindings: mergeTimes(withAi), withoutAiFindings: mergeTimes(withoutAi) },
    byBot,
    byRepoAndBot,
    topDismissedFiles: [...dismissedByFile.values()].sort((a, b) => b.dismissed - a.dismissed).slice(0, 10),
    findings,
  };
}
