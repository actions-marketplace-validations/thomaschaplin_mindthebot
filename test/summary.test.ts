import { describe, expect, it } from "vitest";
import { commitAt, sameIssue, summaryFindings, titleSimilarity, type RaisedItem } from "../src/collect/summary-findings.ts";
import { extractSummaryItems } from "../src/collect/summary-items.ts";
import { classify } from "../src/classify/rules.ts";
import { defaultConfig } from "../src/config.ts";
import { extractSeverity } from "../src/detect/severity.ts";
import { makeFinding } from "./helpers.ts";

// Shaped like claude-code-action's sticky review comment.
const REVIEW = `**Claude finished @dev's task in 56s** —— [View job](https://github.com/acme/web/actions/runs/1)

---
**Code Review** -- 2 issue(s) found

1. [WARNING] **Correctness: balance includes the reserve**
   \`packages/wallet/src/adapter.ts:164\` -- \`getBalance\` returns the raw balance.
   [Fix this →](https://claude.ai/code?q=x)

2. [NOTE] **Repo guidelines: new files lack a header**
   \`packages/wallet/src/adapter.ts:1\`, \`src/types.ts:1\` -- add the 2-line header.

I also checked the memo encoding and found no other high-confidence issues.

Reviewed 27 files, 675 lines changed.`;

describe("extractSummaryItems", () => {
  it("extracts numbered items with a file and line, plus title and severity", () => {
    const items = extractSummaryItems(REVIEW);
    expect(items.map(({ path, line, endLine, severity, title }) => ({ path, line, endLine, severity, title }))).toEqual([
      { path: "packages/wallet/src/adapter.ts", line: 164, endLine: null, severity: "warning", title: "Correctness: balance includes the reserve" },
      { path: "packages/wallet/src/adapter.ts", line: 1, endLine: null, severity: "note", title: "Repo guidelines: new files lack a header" },
    ]);
  });

  it("reads line ranges and GitHub blob links", () => {
    expect(extractSummaryItems("- **Leak** `src/a.ts:171-190` -- still open")[0]).toMatchObject({ line: 171, endLine: 190 });
    const link = "1. Unchecked call in https://github.com/acme/web/blob/abc123/src/b.ts#L10-L12";
    expect(extractSummaryItems(link)[0]).toMatchObject({ path: "src/b.ts", line: 10, endLine: 12 });
  });

  it("skips items without a location, like docs suggestions", () => {
    const docs = "**Affected pages**:\n- `references/sdk/adapters.mdx`: update\n- Consider renaming the section";
    expect(extractSummaryItems(docs)).toEqual([]);
  });

  it("doesn't let trailing paragraphs leak into the last item", () => {
    const items = extractSummaryItems(REVIEW);
    expect(items[1]!.text).not.toContain("Reviewed 27 files");
  });
});

describe("extractSeverity", () => {
  it("normalises the common styles", () => {
    expect(extractSeverity('<img src="https://x/badges/p1.svg?v=9"> **Bug**')).toBe("p1");
    expect(extractSeverity("[WARNING] **Correctness**")).toBe("warning");
    expect(extractSeverity("**Critical:** injection")).toBe("critical");
    expect(extractSeverity("🔴 Runs can be rejected")).toBe("important");
    expect(extractSeverity("Looks fine, but an error could occur much later")).toBeNull();
  });
});

const raised = (overrides: Partial<RaisedItem>): RaisedItem => ({
  title: "Correctness: balance includes the reserve",
  text: "",
  path: "src/adapter.ts",
  line: 164,
  endLine: null,
  severity: "warning",
  bot: "Claude",
  commentId: 1,
  url: "u",
  deliveredAt: "2026-11-16T19:14:00Z",
  ...overrides,
});

describe("summaryFindings", () => {
  const commits = [
    { oid: "first", committedDate: "2026-11-16T19:10:00Z" },
    { oid: "second", committedDate: "2026-11-16T19:30:00Z" },
    { oid: "third", committedDate: "2026-11-16T20:00:00Z" },
  ];

  it("merges a repeated issue and checks it from the latest review that raised it", () => {
    const findings = summaryFindings(
      "acme/web",
      1,
      [
        raised({}),
        raised({
          title: "Correctness: the balance includes the reserve, so Max allows failing payments",
          line: 171,
          endLine: 190,
          commentId: 2,
          deliveredAt: "2026-11-16T19:37:00Z",
        }),
      ],
      commits,
      defaultConfig,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      repeats: 1,
      createdAt: "2026-11-16T19:14:00Z", // first raised
      commitOid: "second", // the code at the second review
      line: 171,
      endLine: 190,
      source: "summary",
    });
  });

  it("keeps different issues in the same file apart", () => {
    const findings = summaryFindings(
      "acme/web",
      1,
      [raised({}), raised({ title: "Repo guidelines: new files lack a header", line: 1, commentId: 2 })],
      commits,
      defaultConfig,
    );
    expect(findings).toHaveLength(2);
  });

  it("doesn't merge issues from different reviewers", () => {
    expect(summaryFindings("acme/web", 1, [raised({}), raised({ bot: "Greptile" })], commits, defaultConfig)).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("titleSimilarity is high for rewordings and low for different issues", () => {
    expect(titleSimilarity("XRP balance includes the account reserve", "the XRP balance includes the reserve")).toBeGreaterThan(0.5);
    expect(titleSimilarity("XRP balance includes the account reserve", "new files lack a header")).toBe(0);
  });

  it("sameIssue matches overlapping ranges in the same file", () => {
    const a = raised({ title: "a" });
    expect(sameIssue(a, raised({ title: "b", line: 160, endLine: 170 }), 3)).toBe(true);
    expect(sameIssue(a, raised({ title: "b", path: "src/other.ts" }), 3)).toBe(false);
  });

  it("commitAt picks the newest commit at or before the time", () => {
    const commits = [
      { oid: "a", committedDate: "2026-01-01T10:00:00Z" },
      { oid: "b", committedDate: "2026-01-01T12:00:00Z" },
    ];
    expect(commitAt(commits, "2026-01-01T11:00:00Z")).toBe("a");
    expect(commitAt(commits, "2026-01-01T12:00:00Z")).toBe("b");
    expect(commitAt(commits, "2026-01-01T09:00:00Z")).toBeNull();
  });
});

describe("classify summary items", () => {
  const item = makeFinding({ source: "summary", line: 171, endLine: 190 });

  it("addressed when a change lands inside the reported range", () => {
    expect(classify(item, { "src/users.ts": [180] }, defaultConfig).outcome).toBe("addressed");
  });

  it("not-addressed otherwise, never dismissed or ignored", () => {
    expect(classify(item, { "src/users.ts": [250] }, defaultConfig).outcome).toBe("not-addressed");
    expect(classify(item, {}, defaultConfig).outcome).toBe("not-addressed");
    expect(classify(item, null, defaultConfig).reason).toMatch(/no diff/);
  });
});

describe("toRecord with summary comments", async () => {
  const { toRecord } = await import("../src/collect/pull-requests.ts");
  const base = {
    number: 5,
    url: "u",
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    mergedAt: "2026-11-01T12:00:00Z",
    headRefOid: "head",
    commits: { nodes: [{ commit: { oid: "c", committedDate: "2026-11-01T09:00:00Z" } }] },
    reviews: { nodes: [] },
  };
  const comment = (body: string) => ({
    databaseId: 1,
    url: "u",
    author: { login: "github-actions" },
    body,
    createdAt: "2026-11-01T10:05:00Z",
    lastEditedAt: null,
  });

  it("ignores items without a severity label by default", () => {
    const pr = {
      ...base,
      comments: { nodes: [comment("**Claude** docs review\n\n- **The parser will pick it up.** It matches `scripts/build.mjs:190`.")] },
      reviewThreads: { nodes: [] },
    };
    expect(toRecord("acme/web", pr, defaultConfig).findings).toEqual([]);
    expect(toRecord("acme/web", pr, { ...defaultConfig, summaryRequiresSeverity: false }).findings).toHaveLength(1);
  });

  it("drops a summary item that repeats the same bot's inline comment", () => {
    const pr = {
      ...base,
      comments: { nodes: [comment("**Claude** review\n\n1. [WARNING] **Null check** `src/a.ts:40`")] },
      reviewThreads: {
        nodes: [
          {
            isResolved: false,
            isOutdated: false,
            path: "src/a.ts",
            originalLine: 41,
            comments: {
              nodes: [
                {
                  databaseId: 9,
                  url: "u",
                  author: { login: "claude" },
                  body: "Null check missing",
                  createdAt: "2026-11-01T10:05:00Z",
                  originalCommit: { oid: "c" },
                  reactionGroups: [],
                },
              ],
            },
          },
        ],
      },
    };
    const findings = toRecord("acme/web", pr, defaultConfig).findings;
    expect(findings.map((f) => f.source)).toEqual(["inline"]);
  });
});

describe("path and line formats", async () => {
  const { resolvePath } = await import("../src/classify/rules.ts");

  it("reads comma-separated line lists, using the first line", () => {
    expect(extractSummaryItems("1. [NOTE] **x** `src/adapter.ts:39,63`: details")[0]).toMatchObject({ line: 39, endLine: null });
  });

  it("resolves a bare filename to the one changed file that ends with it", () => {
    const changes = { "packages/tron/src/adapter.ts": [103], "packages/xrp/src/index.ts": [1] };
    expect(resolvePath("adapter.ts", changes)).toBe("packages/tron/src/adapter.ts");
    expect(resolvePath("src/adapter.ts", changes)).toBe("packages/tron/src/adapter.ts");
  });

  it("leaves ambiguous filenames unresolved", () => {
    const changes = { "a/index.ts": [1], "b/index.ts": [1] };
    expect(resolvePath("index.ts", changes)).toBe("index.ts");
  });
});

describe("more severity formats", () => {
  it("reads CodeRabbit labels in both the icon and the emoji style", () => {
    const icon =
      '<!-- coderabbit-ai-generated:v1 -->\n\n**<picture><img src="https://x/review-comment-icons-v1/major-16.svg" alt=""></picture> Major** · **Data Integrity**';
    expect(extractSeverity(icon)).toBe("major");
    expect(extractSeverity("_⚠️ Potential issue_ | _🟠 Major_\n\n**Missing await**")).toBe("major");
    expect(extractSeverity("_🧹 Nitpick_ | _🔵 Trivial_")).toBe("trivial");
  });

  it("skips a leading HTML-comment metadata block", () => {
    const body = `<!-- metadata:{"confidence":9,"steps":[{"text":"${"x".repeat(5000)}"}]} -->\n**[WARNING]** Missing null check`;
    expect(extractSeverity(body)).toBe("warning");
  });
});
