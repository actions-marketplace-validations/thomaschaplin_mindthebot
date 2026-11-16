import type { Config } from "../config.ts";
import { detectBot, isBotLogin } from "../detect/bots.ts";
import { extractSeverity } from "../detect/severity.ts";
import type { Finding, PullRequestRecord, SummaryComment } from "../types.ts";
import { summaryFindings, type RaisedItem } from "./summary-findings.ts";
import { extractSummaryItems } from "./summary-items.ts";
import type { Cache } from "./cache.ts";
import { splitRepo, type GitHubClient } from "./github.ts";

const QUERY = /* GraphQL */ `
  query ($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(
        states: MERGED
        first: 20
        after: $cursor
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          url
          createdAt
          updatedAt
          mergedAt
          headRefOid
          commits(last: 100) {
            nodes { commit { oid committedDate } }
          }
          comments(first: 50) {
            nodes { databaseId url author { login } body createdAt lastEditedAt }
          }
          reviews(first: 50) {
            nodes { databaseId url author { login } body createdAt lastEditedAt }
          }
          reviewThreads(first: 100) {
            nodes {
              isResolved
              isOutdated
              path
              originalLine
              comments(first: 20) {
                nodes {
                  databaseId
                  url
                  author { login }
                  body
                  createdAt
                  originalCommit { oid }
                  reactionGroups { content reactors { totalCount } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Shapes of the GraphQL response, limited to the fields we ask for.
interface Author { login: string }
interface RawSummary {
  databaseId: number;
  url: string;
  author: Author | null;
  body: string;
  createdAt: string;
  lastEditedAt: string | null;
}
interface RawComment {
  databaseId: number;
  url: string;
  author: Author | null;
  body: string;
  createdAt: string;
  originalCommit: { oid: string } | null;
  reactionGroups: { content: string; reactors: { totalCount: number } }[] | null;
}
interface RawThread {
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  originalLine: number | null;
  comments: { nodes: RawComment[] };
}
export interface RawPullRequest {
  number: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string;
  headRefOid: string;
  commits: { nodes: { commit: { oid: string; committedDate: string } }[] };
  comments: { nodes: RawSummary[] };
  reviews: { nodes: RawSummary[] };
  reviewThreads: { nodes: RawThread[] };
}
interface QueryResult {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawPullRequest[];
    };
  };
}

function reactionCount(comment: RawComment, content: string): number {
  return comment.reactionGroups?.find((g) => g.content === content)?.reactors.totalCount ?? 0;
}

/** Turn one raw pull request into a record of AI findings and summary comments. Pure, so it's easy to test. */
export function toRecord(repo: string, pr: RawPullRequest, config: Config): PullRequestRecord {
  const findings: Finding[] = [];
  for (const thread of pr.reviewThreads.nodes) {
    const [first, ...rest] = thread.comments.nodes;
    if (!first) continue;
    const bot = detectBot(config.bots, first.author?.login, first.body);
    if (!bot) continue;
    findings.push({
      repo,
      pr: pr.number,
      bot,
      source: "inline",
      severity: extractSeverity(first.body),
      commentId: first.databaseId,
      url: first.url,
      createdAt: first.createdAt,
      body: first.body,
      path: thread.path,
      line: thread.originalLine,
      endLine: null,
      commitOid: first.originalCommit?.oid ?? null,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      reactions: { up: reactionCount(first, "THUMBS_UP"), down: reactionCount(first, "THUMBS_DOWN") },
      replies: rest
        .filter((c) => !isBotLogin(config.bots, c.author?.login))
        .map((c) => ({ author: c.author?.login ?? "ghost", body: c.body, createdAt: c.createdAt })),
      repeats: 0,
    });
  }

  const summaries: SummaryComment[] = [];
  const raised: RaisedItem[] = [];
  for (const c of [...pr.comments.nodes, ...pr.reviews.nodes]) {
    if (!c.body.trim()) continue; // Reviews that only carry inline comments have an empty body.
    const bot = detectBot(config.bots, c.author?.login, c.body);
    if (!bot) continue;
    // Some bots post a placeholder and edit it when the review finishes; the edit time is when it was delivered.
    const deliveredAt = c.lastEditedAt ?? c.createdAt;
    const items = extractSummaryItems(c.body).filter((i) => !config.summaryRequiresSeverity || i.severity !== null);
    summaries.push({ bot, createdAt: deliveredAt, items: items.length });
    for (const item of items) {
      raised.push({ ...item, bot, commentId: c.databaseId, url: c.url, deliveredAt });
    }
  }
  const commits = pr.commits.nodes.map((n) => n.commit);
  // Some bots repeat their inline comments in the summary; count each issue once.
  const fromSummaries = summaryFindings(repo, pr.number, raised, commits, config).filter(
    (s) =>
      !findings.some(
        (f) =>
          f.bot === s.bot &&
          f.path === s.path &&
          f.line !== null &&
          s.line !== null &&
          f.line >= s.line - config.proximity &&
          f.line <= (s.endLine ?? s.line) + config.proximity,
      ),
  );
  findings.push(...fromSummaries);

  return {
    repo,
    number: pr.number,
    url: pr.url,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    headOid: pr.headRefOid,
    findings,
    summaries,
  };
}

/** Fetch merged pull requests updated within the window, newest first. */
export async function fetchMergedPullRequests(
  client: GitHubClient,
  cache: Cache,
  repo: string,
  sinceMs: number,
  maxPrs: number,
): Promise<RawPullRequest[]> {
  const { owner, name } = splitRepo(repo);
  const cutoff = Date.now() - sinceMs;
  const results: RawPullRequest[] = [];
  let cursor: string | null = null;

  while (results.length < maxPrs) {
    const page: QueryResult = await cache.wrap(["prs-v2", owner, name, cursor, Math.floor(cutoff / 3_600_000)], () =>
      client.graphql<QueryResult>(QUERY, { owner, name, cursor }),
    );
    const { nodes, pageInfo } = page.repository.pullRequests;
    let reachedCutoff = false;
    for (const pr of nodes) {
      // Sorted by updatedAt, which is always at or after mergedAt, so we can stop here.
      if (Date.parse(pr.updatedAt) < cutoff) {
        reachedCutoff = true;
        break;
      }
      if (Date.parse(pr.mergedAt) >= cutoff) results.push(pr);
      if (results.length >= maxPrs) break;
    }
    if (reachedCutoff || !pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  return results;
}
