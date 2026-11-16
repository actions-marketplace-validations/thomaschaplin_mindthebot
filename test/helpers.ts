import type { Finding } from "../src/types.ts";

/** A finding with sensible defaults; override only what a test cares about. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    repo: "acme/api",
    pr: 1,
    bot: "Claude",
    commentId: 100,
    url: "https://github.com/acme/api/pull/1#discussion_r100",
    createdAt: "2026-11-01T10:00:00Z",
    body: "This can throw if `user` is undefined.",
    path: "src/users.ts",
    line: 40,
    commitOid: "aaa",
    isResolved: false,
    isOutdated: false,
    reactions: { up: 0, down: 0 },
    replies: [],
    ...overrides,
  };
}

export const reply = (body: string) => ({ author: "dev", body, createdAt: "2026-11-01T11:00:00Z" });
