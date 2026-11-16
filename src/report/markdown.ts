import type { BotStats, Ledger, MergeTimes } from "../aggregate/metrics.ts";

const pct = (n: number) => `${Math.round(n * 100)}%`;
/** "12 (40%)", or "–" when there's nothing to take a rate of. */
const countWithRate = (count: number, rate: number, total: number) => (total === 0 ? "–" : `${count} (${pct(rate)})`);
const num = (n: number | null, digits = 1) => (n === null ? "–" : n.toFixed(digits));

function duration(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

/** "12", or "12 (4 inline, 8 summary)" when both sources are present. */
function findingsCell(s: BotStats): string {
  if (s.inlineFindings > 0 && s.summaryFindings > 0) {
    return `${s.findings} (${s.inlineFindings} inline, ${s.summaryFindings} summary)`;
  }
  if (s.summaryFindings > 0) return `${s.findings} (summary)`;
  return String(s.findings);
}

function botTable(rows: BotStats[], withRepo: boolean): string {
  const head = [
    ...(withRepo ? ["Repo"] : []),
    "Reviewer",
    "PRs",
    "Findings",
    "Addressed",
    "Dismissed",
    "Ignored",
    "Not addressed",
    "Outdated",
    "Per PR",
    "First comment",
  ];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const s of rows) {
    lines.push(
      `| ${[
        ...(withRepo ? [s.repo] : []),
        s.bot,
        s.prsReviewed,
        findingsCell(s),
        countWithRate(s.addressed, s.addressedRate, s.findings),
        countWithRate(s.dismissed, s.dismissedRate, s.findings),
        countWithRate(s.ignored, s.ignoredRate, s.findings),
        countWithRate(s.notAddressed, s.notAddressedRate, s.findings),
        s.findings === 0 ? "–" : s.outdated,
        s.findings === 0 ? "–" : num(s.findingsPerPr),
        duration(s.medianFirstCommentMinutes),
      ].join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

function mergeRow(label: string, m: MergeTimes): string {
  return `| ${label} | ${m.prs} | ${num(m.medianHours)}h | ${num(m.p75Hours)}h |`;
}

export function renderMarkdown(ledger: Ledger): string {
  const out: string[] = [];
  out.push(`# AI review ledger`);
  out.push(
    `Merged PRs from the last **${ledger.since}** in ${ledger.repos.map((r) => `\`${r}\``).join(", ")}. ` +
      `${ledger.prsAnalysed} PRs analysed, ${ledger.prsWithAi} with AI review comments. Generated ${ledger.generatedAt.slice(0, 10)}.`,
  );

  out.push(`## By reviewer`);
  if (ledger.byBot.length === 0) {
    out.push("_No comments from configured AI reviewers in this window._");
  } else {
    out.push(botTable(ledger.byBot, false));
    out.push(
      "_**Addressed**: code near the comment changed afterwards, or a reply/👍 confirmed it. " +
        "**Dismissed**: 👎, a dismissing reply, or resolved with no nearby change. " +
        "**Ignored**: no response. **Not addressed**: a summary-comment item with no nearby change (summaries have no replies or resolution, so dismissed and ignored look the same). " +
        "**Outdated**: GitHub marked the thread outdated but no nearby change was found. " +
        "**Per PR**: findings per PR the reviewer commented on. **First comment**: median time from PR opened to the review being delivered._",
    );
  }

  if (ledger.repos.length > 1 && ledger.byRepoAndBot.length > 0) {
    out.push(`## By repo`);
    out.push(botTable(ledger.byRepoAndBot, true));
  }

  if (ledger.bySeverity.length > 0) {
    out.push(`## By severity`);
    out.push(
      [
        "| Reviewer | Severity | Findings | Addressed |",
        "|---|---|---|---|",
        ...ledger.bySeverity.map((s) => `| ${s.bot} | ${s.severity} | ${s.findings} | ${s.addressed} (${pct(s.addressedRate)}) |`),
      ].join("\n"),
    );
    out.push("_Severity as labelled by the reviewer itself. A low addressed rate on its highest severity is the number to look at first._");
  }

  out.push(`## Time to merge`);
  out.push(
    ["| PRs | Count | Median | p75 |", "|---|---|---|---|", mergeRow("With AI findings", ledger.timeToMerge.withAiFindings), mergeRow("Without AI findings", ledger.timeToMerge.withoutAiFindings)].join("\n"),
  );
  out.push("_Context only: bigger PRs attract more findings and take longer to merge, so this doesn't show cause and effect._");

  if (ledger.topDismissedFiles.length > 0) {
    out.push(`## Files where findings get dismissed most`);
    out.push("Candidates for path exclusions or extra context in your review instructions.");
    out.push(ledger.topDismissedFiles.map((f) => `- \`${f.repo}\` \`${f.path}\`: ${f.dismissed}`).join("\n"));
  }

  return `${out.join("\n\n")}\n`;
}
