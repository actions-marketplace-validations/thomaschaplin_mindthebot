import { describe, expect, it } from "vitest";
import { Cache } from "../src/collect/cache.ts";
import { changedLinesSince } from "../src/collect/changes.ts";
import type { GitHubClient } from "../src/collect/github.ts";
import type { PrCommit } from "../src/types.ts";

const patch = (line: number) => `@@ -${line},1 +${line},1 @@\n-old\n+new`;

/** A fake client that records which endpoints were called. */
function fakeClient(responses: { compare?: unknown[]; commits?: Record<string, unknown[]> }) {
  const calls: string[] = [];
  const client = {
    request: async (route: string, params: { ref?: string }) => {
      calls.push(route.includes("compare") ? "compare" : `commit:${params.ref}`);
      if (route.includes("compare")) return { data: { files: responses.compare ?? [] } };
      return { data: { files: responses.commits?.[params.ref!] ?? [] } };
    },
  } as unknown as GitHubClient;
  return { client, calls };
}

const cache = new Cache("unused", false);
const commit = (oid: string, isMerge = false): PrCommit => ({ oid, committedDate: "2026-11-01T00:00:00Z", isMerge });

describe("changedLinesSince", () => {
  it("uses one comparison when the base branch wasn't merged in after the comment", async () => {
    const { client, calls } = fakeClient({ compare: [{ filename: "src/a.ts", patch: patch(10) }] });
    const changes = await changedLinesSince(client, cache, "o/r", "c1", "c3", [commit("c1"), commit("c2"), commit("c3")]);
    expect(changes).toEqual({ "src/a.ts": [10] });
    expect(calls).toEqual(["compare"]);
  });

  it("combines the PR's own commits when the base branch was merged in after the comment", async () => {
    const { client, calls } = fakeClient({
      commits: { c2: [{ filename: "src/a.ts", patch: patch(10) }], c4: [{ filename: "src/a.ts", patch: patch(40) }] },
    });
    const prCommits = [commit("c1"), commit("c2"), commit("m3", true), commit("c4")];
    const changes = await changedLinesSince(client, cache, "o/r", "c1", "c4", prCommits);
    expect(changes).toEqual({ "src/a.ts": [10, 40] });
    // No compare call, and the merge commit (everyone else's changes) is skipped.
    expect(calls).toEqual(["commit:c2", "commit:c4"]);
  });

  it("falls back to per-commit diffs when the comparison hits GitHub's 300-file limit", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.ts`, patch: patch(1) }));
    const { client, calls } = fakeClient({ compare: many, commits: { c2: [{ filename: "src/a.ts", patch: patch(5) }] } });
    const changes = await changedLinesSince(client, cache, "o/r", "c1", "c2", [commit("c1"), commit("c2")]);
    expect(changes).toEqual({ "src/a.ts": [5] });
    expect(calls).toEqual(["compare", "commit:c2"]);
  });

  it("returns no changes when the comment was on the final commit", async () => {
    const { client, calls } = fakeClient({});
    expect(await changedLinesSince(client, cache, "o/r", "c1", "c1", [commit("c1")])).toEqual({});
    expect(calls).toEqual([]);
  });
});
