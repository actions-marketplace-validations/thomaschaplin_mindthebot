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

describe("serviceStatus", async () => {
  const { serviceStatus } = await import("../src/report/markdown.ts");
  const stats = (findings: number, addressedRate: number) =>
    ({ findings, addressedRate }) as Parameters<typeof serviceStatus>[0];

  it("maps the addressed rate to a Tube-style status", () => {
    expect(serviceStatus(stats(10, 0.6)).label).toBe("Good service");
    expect(serviceStatus(stats(10, 0.45)).label).toBe("Minor delays");
    expect(serviceStatus(stats(10, 0.1)).label).toBe("Severe delays");
    expect(serviceStatus(stats(0, 0)).label).toBe("No findings");
    expect(serviceStatus(stats(3, 0)).label).toBe("Too few findings");
  });
});
