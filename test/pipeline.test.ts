import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildLedger } from "../src/aggregate/metrics.ts";
import { classify } from "../src/classify/rules.ts";
import { toRecord, type RawPullRequest } from "../src/collect/pull-requests.ts";
import { defaultConfig } from "../src/config.ts";
import { renderMarkdown } from "../src/report/markdown.ts";
import type { ChangedLines } from "../src/types.ts";
import { parseDuration } from "../src/util/duration.ts";
import { percentile } from "../src/util/stats.ts";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/pull-requests.json", import.meta.url), "utf8"),
) as { repo: string; pullRequests: RawPullRequest[]; changes: Record<string, ChangedLines> };

function runFixture() {
  const prs = fixture.pullRequests.map((pr) => toRecord(fixture.repo, pr, defaultConfig));
  const findings = prs.flatMap((pr) =>
    pr.findings.map((f) => classify(f, f.commitOid ? fixture.changes[f.commitOid] : null, defaultConfig)),
  );
  return buildLedger(prs, findings, { since: "30d", repos: [fixture.repo], now: new Date("2026-11-16T00:00:00Z") });
}

describe("toRecord", () => {
  it("keeps bot threads, drops human threads, and excludes bot replies", () => {
    const record = toRecord(fixture.repo, fixture.pullRequests[0]!, defaultConfig);
    expect(record.findings.map((f) => f.bot)).toEqual(["Claude", "Claude", "Greptile"]);
    expect(record.findings[0]!.replies.map((r) => r.author)).toEqual(["alice"]);
    expect(record.summaries).toEqual([{ bot: "Claude", createdAt: "2026-11-02T09:05:00Z", items: 0 }]);
  });

  it("turns located summary items into findings checked against the commit the reviewer saw", () => {
    const record = toRecord(fixture.repo, fixture.pullRequests[1]!, defaultConfig);
    const summary = record.findings.filter((f) => f.source === "summary");
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      bot: "Claude",
      severity: "warning",
      path: "src/api.ts",
      line: 12,
      endLine: 15,
      commitOid: "c2",
      // The placeholder was posted at 10:00:30 and edited at 10:01:30.
      createdAt: "2026-11-03T10:01:30Z",
    });
    expect(record.summaries).toEqual([{ bot: "Claude", createdAt: "2026-11-03T10:01:30Z", items: 1 }]);
  });
});

describe("buildLedger", () => {
  const ledger = runFixture();

  it("counts outcomes per reviewer", () => {
    const claude = ledger.byBot.find((s) => s.bot === "Claude")!;
    expect(claude).toMatchObject({
      findings: 3,
      inlineFindings: 2,
      summaryFindings: 1,
      addressed: 1,
      dismissed: 1,
      ignored: 0,
      notAddressed: 1,
      prsReviewed: 2,
    });
    // PR 10: 5 minutes. PR 11: 1.5 minutes (delivered when the placeholder was edited).
    expect(claude.medianFirstCommentMinutes).toBe(1.5);

    const greptile = ledger.byBot.find((s) => s.bot === "Greptile")!;
    expect(greptile).toMatchObject({ findings: 2, addressed: 0, ignored: 2, prsReviewed: 2 });
  });

  it("breaks findings down by severity", () => {
    expect(ledger.bySeverity).toEqual([{ bot: "Claude", severity: "warning", findings: 1, addressed: 0, addressedRate: 0 }]);
  });

  it("splits time to merge by whether PRs had AI findings", () => {
    expect(ledger.timeToMerge.withAiFindings.prs).toBe(2);
    expect(ledger.timeToMerge.withoutAiFindings.prs).toBe(1);
  });

  it("lists files where findings were dismissed", () => {
    expect(ledger.topDismissedFiles).toEqual([{ repo: "acme/api", path: "src/config.ts", dismissed: 1 }]);
  });

  it("renders a stable markdown report", () => {
    expect(renderMarkdown(ledger)).toMatchSnapshot();
  });
});

describe("utils", () => {
  it("parses durations", () => {
    expect(parseDuration("2w")).toBe(14 * 24 * 3_600_000);
    expect(() => parseDuration("30 days")).toThrow(/Invalid duration/);
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("reviewerStatus", async () => {
  const { reviewerStatus } = await import("../src/report/markdown.ts");
  const stats = (findings: number, addressedRate: number) =>
    ({ findings, addressedRate }) as Parameters<typeof reviewerStatus>[0];

  it("maps the addressed rate to a status", () => {
    expect(reviewerStatus(stats(10, 0.6)).label).toBe("Mostly acted on");
    expect(reviewerStatus(stats(10, 0.45)).label).toBe("Partly acted on");
    expect(reviewerStatus(stats(10, 0.1)).label).toBe("Mostly not acted on");
    expect(reviewerStatus(stats(0, 0)).label).toBe("No findings");
    expect(reviewerStatus(stats(3, 0)).label).toBe("Too few findings");
  });
});

describe("report helpers", async () => {
  const { snippet, sinceLabel, bar } = await import("../src/report/markdown.ts");

  it("pulls the first readable line out of a review comment", () => {
    expect(snippet('<a href="x"><img alt="P1 Badge" src="y"></a> **Null check missing** in `load`\n\nMore text')).toBe(
      "Null check missing",
    );
    expect(snippet("🟡 (optional) Retry never stops")).toBe("Retry never stops");
    expect(snippet("🟣 pre-existing, not blocking: on hosts with shared runners, state leaks")).toBe("On hosts with shared runners, state leaks");
    expect(snippet("[WARNING] Correctness: timeout | leak")).toBe("Correctness: timeout \\| leak");
    expect(snippet("<!-- meta -->\n```ts\ncode\n```\nReal text")).toBe("Real text");
    const coderabbit =
      '<!-- x -->\n\n**<picture><img src="a.svg" alt=""></picture> Minor** · **Functional Correctness** · **Quick win**\n\n**Respect reduced motion.**\n\nBody.';
    expect(snippet(coderabbit)).toBe("Respect reduced motion.");
    expect(snippet("**<sub><sub>![P1 Badge](https://x/p1)</sub></sub>  Document the lifecycle**\n\nBody")).toBe("Document the lifecycle");
    expect(snippet("**App IDs lack discovery guidance** The new filter needs an owned id.")).toBe("App IDs lack discovery guidance");
    expect(snippet("Needs an owned `app_id_<uuid>` and returns `Array<string>`")).toBe(
      "Needs an owned `app_id_<uuid>` and returns `Array<string>`",
    );
    expect(snippet("Generic Map<K, V> is unsafe")).toBe("Generic Map&lt;K, V&gt; is unsafe");
    expect(snippet("Call `parse<T>(raw) then more words here", 30)).toBe("Call parse<T>(raw) then more…".replace("<", "&lt;").replace(">", "&gt;"));
    expect(snippet('<sub><a href="x"><img alt="P2"></a></sub><br/>Uses <b>bold</b> text')).toBe("Uses bold text");
    expect(snippet("a".repeat(5) + " " + "word ".repeat(40), 20)).toHaveLength(20);
  });

  it("labels durations and draws bars", () => {
    expect(sinceLabel("7d")).toBe("7 days");
    expect(sinceLabel("1w")).toBe("1 week");
    expect(sinceLabel("12h")).toBe("12 hours");
    expect(bar(0.53)).toBe("`█████░░░░░`");
    expect(bar(1)).toBe("`██████████`");
  });
});

describe("topIgnoredFiles", () => {
  const ledger = runFixture();
  it("ranks files by ignored findings, with the findings to link to", () => {
    expect(ledger.topIgnoredFiles.map((f) => [f.path, f.ignored, f.findings])).toEqual([
      ["src/api.ts", 2, 2],
      ["src/db.ts", 1, 1],
    ]);
    expect(ledger.topIgnoredFiles[0]!.items.map((f) => f.line)).toEqual([7, 12]);
  });
});
