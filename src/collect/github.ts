import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/core";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

const ThrottledOctokit = Octokit.plugin(throttling, retry);
export type GitHubClient = InstanceType<typeof ThrottledOctokit>;

/** Use GITHUB_TOKEN, or fall back to the GitHub CLI's token if it's installed. */
export function resolveToken(): string {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No GitHub token found. Set GITHUB_TOKEN, or log in with `gh auth login`.");
  }
}

export function createClient(token: string): GitHubClient {
  return new ThrottledOctokit({
    auth: token,
    userAgent: "mindthebot",
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        process.stderr.write(`Rate limited on ${options.url}; retrying in ${retryAfter}s\n`);
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter, options) => {
        process.stderr.write(`Secondary rate limit on ${options.url}; retrying in ${retryAfter}s\n`);
        return true;
      },
    },
  });
}

export function splitRepo(fullName: string): { owner: string; name: string } {
  const [owner, name, ...rest] = fullName.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`Invalid repo "${fullName}". Use owner/name.`);
  }
  return { owner, name };
}
