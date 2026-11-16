import type { BotStats, Ledger, MergeTimes } from "../aggregate/metrics.ts";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const num = (n: number | null, digits = 1) => (n === null ? "–" : n.toFixed(digits));

function duration(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
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
        s.findings,
        `${s.addressed} (${pct(s.addressedRate)})`,
        `${s.dismissed} (${pct(s.dismissedRate)})`,
        `${s.ignored} (${pct(s.ignoredRate)})`,
        s.outdated,
        num(s.findingsPerPr),
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
        "**Ignored**: no response. **Outdated**: GitHub marked the thread outdated but no nearby change was found. " +
        "**Per PR**: inline findings per PR the reviewer commented on. **First comment**: median time from PR opened._",
    );
  }

  if (ledger.repos.length > 1 && ledger.byRepoAndBot.length > 0) {
    out.push(`## By repo`);
    out.push(botTable(ledger.byRepoAndBot, true));
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
