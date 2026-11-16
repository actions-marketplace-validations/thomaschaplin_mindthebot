import { touchedOldLines } from "../classify/patch.ts";
import type { ChangedLines, PrCommit } from "../types.ts";
import type { Cache } from "./cache.ts";
import { splitRepo, type GitHubClient } from "./github.ts";

interface FileDiff {
  filename: string;
  previous_filename?: string;
  patch?: string;
}

/** GitHub's compare and commit endpoints list at most this many files. */
const FILE_LIMIT = 300;
/** Cap on per-commit lookups for one finding, to keep big PRs affordable. */
const MAX_COMMITS = 50;

function toChangedLines(files: FileDiff[], into: ChangedLines = {}): ChangedLines {
  for (const file of files) {
    const lines = file.patch === undefined ? null : touchedOldLines(file.patch);
    for (const name of [file.filename, file.previous_filename]) {
      if (!name) continue;
      const existing = into[name];
      // Union with what's already known. `null` (no patch) only wins if we have nothing better.
      if (existing === undefined || existing === null) into[name] = lines ?? existing ?? null;
      else if (lines) into[name] = [...new Set([...existing, ...lines])].sort((a, b) => a - b);
    }
  }
  return into;
}

function mergeLines(a: number[] | null | undefined, b: number[] | null | undefined): number[] | null {
  if (!a && !b) return null;
  return [...new Set([...(a ?? []), ...(b ?? [])])].sort((x, y) => x - y);
}

const slim = (files: FileDiff[] | undefined): FileDiff[] =>
  (files ?? []).map((f) => ({ filename: f.filename, previous_filename: f.previous_filename, patch: f.patch }));

async function compareFiles(client: GitHubClient, cache: Cache, owner: string, name: string, base: string, head: string) {
  return cache.wrap(["compare", owner, name, base, head], async () => {
    const res = await client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
      owner,
      repo: name,
      basehead: `${base}...${head}`,
    });
    return { files: slim((res.data as { files?: FileDiff[] }).files) };
  });
}

async function commitFiles(client: GitHubClient, cache: Cache, owner: string, name: string, oid: string) {
  return cache.wrap(["commit", owner, name, oid], async () => {
    const res = await client.request("GET /repos/{owner}/{repo}/commits/{ref}", { owner, repo: name, ref: oid });
    return { files: slim((res.data as { files?: FileDiff[] }).files) };
  });
}

/**
 * Lines changed after a comment, keyed by file path.
 *
 * - **Normally** this compares the commented commit with the PR's final head,
 *   which gives exact line numbers in the commented commit's coordinates.
 * - **If the base branch was merged into the PR after the comment**, that
 *   comparison would include everyone else's changes (and on big repos runs
 *   into GitHub's 300-file limit). Instead, the diffs of the PR's own
 *   non-merge commits after the comment are combined. Line numbers are then
 *   approximate, because each commit's diff is relative to its parent.
 *
 * Returns null when no diff can be fetched, e.g. the commented commit was
 * force-pushed away.
 */
export async function changedLinesSince(
  client: GitHubClient,
  cache: Cache,
  repo: string,
  baseOid: string,
  headOid: string,
  prCommits: PrCommit[] = [],
): Promise<ChangedLines | null> {
  if (baseOid === headOid) return {};
  const { owner, name } = splitRepo(repo);

  const index = prCommits.findIndex((c) => c.oid === baseOid);
  // If the commented commit isn't in the list (older than the last 100), treat every listed commit as later.
  const after = index >= 0 ? prCommits.slice(index + 1) : prCommits;
  const mergedBaseAfterComment = after.some((c) => c.isMerge);

  try {
    if (!mergedBaseAfterComment) {
      const { files } = await compareFiles(client, cache, owner, name, baseOid, headOid);
      if (files.length < FILE_LIMIT) return toChangedLines(files);
      // Truncated: fall through to per-commit diffs.
    }

    const own = after.filter((c) => !c.isMerge).slice(-MAX_COMMITS);
    if (own.length === 0) return after.length > 0 ? {} : null;
    const changed: ChangedLines = {};
    const renames: [string, string][] = [];
    for (const commit of own) {
      const { files } = await commitFiles(client, cache, owner, name, commit.oid);
      toChangedLines(files, changed);
      for (const f of files) if (f.previous_filename) renames.push([f.previous_filename, f.filename]);
    }
    // A file renamed in a later commit: count edits made under either name for both names.
    for (const [from, to] of renames) {
      const merged = mergeLines(changed[from], changed[to]);
      changed[from] = merged;
      changed[to] = merged;
    }
    return changed;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 422) return null;
    throw error;
  }
}
