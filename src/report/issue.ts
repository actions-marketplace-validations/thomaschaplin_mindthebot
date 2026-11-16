import type { GitHubClient } from "../collect/github.ts";
import { splitRepo } from "../collect/github.ts";

export const ISSUE_LABEL = "review-ledger";

/**
 * Create the report issue, or update it if an open one with the same label and
 * title already exists, so a weekly schedule keeps one living issue instead of
 * piling up new ones.
 */
export async function upsertIssue(
  client: GitHubClient,
  repo: string,
  title: string,
  body: string,
): Promise<{ url: string; created: boolean }> {
  const { owner, name } = splitRepo(repo);

  const existing = await client.request("GET /repos/{owner}/{repo}/issues", {
    owner,
    repo: name,
    state: "open",
    labels: ISSUE_LABEL,
    per_page: 100,
  });
  const match = existing.data.find((issue) => issue.title === title && !issue.pull_request);

  if (match) {
    const res = await client.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner,
      repo: name,
      issue_number: match.number,
      body,
    });
    return { url: res.data.html_url, created: false };
  }

  const res = await client.request("POST /repos/{owner}/{repo}/issues", {
    owner,
    repo: name,
    title,
    body,
    labels: [ISSUE_LABEL],
  });
  return { url: res.data.html_url, created: true };
}
