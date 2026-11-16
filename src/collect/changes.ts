import { touchedOldLines } from "../classify/patch.ts";
import type { ChangedLines } from "../types.ts";
import type { Cache } from "./cache.ts";
import { splitRepo, type GitHubClient } from "./github.ts";

interface CompareResponse {
  files?: { filename: string; previous_filename?: string; patch?: string }[];
}

/**
 * Lines changed between the commit a comment was made on and the PR's final
 * head commit, in the coordinates of the commented commit.
 *
 * Returns null when the comparison isn't possible, e.g. the commented commit
 * was force-pushed away.
 */
export async function changedLinesSince(
  client: GitHubClient,
  cache: Cache,
  repo: string,
  baseOid: string,
  headOid: string,
): Promise<ChangedLines | null> {
  if (baseOid === headOid) return {};
  const { owner, name } = splitRepo(repo);
  try {
    const data = await cache.wrap(["compare", owner, name, baseOid, headOid], async () => {
      const res = await client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        owner,
        repo: name,
        basehead: `${baseOid}...${headOid}`,
        per_page: 300,
      });
      // Keep only what we need, so the cache stays small.
      const body = res.data as CompareResponse;
      return {
        files: (body.files ?? []).map((f) => ({
          filename: f.filename,
          previous_filename: f.previous_filename,
          patch: f.patch,
        })),
      } satisfies CompareResponse;
    });

    const changed: ChangedLines = {};
    for (const file of data.files ?? []) {
      const lines = file.patch === undefined ? null : touchedOldLines(file.patch);
      changed[file.filename] = lines;
      // A renamed file keeps the old name in the comment.
      if (file.previous_filename) changed[file.previous_filename] = lines;
    }
    return changed;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 422) return null;
    throw error;
  }
}
