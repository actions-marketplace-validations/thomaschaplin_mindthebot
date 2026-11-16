import { describe, expect, it } from "vitest";
import { classify } from "../src/classify/rules.ts";
import { defaultConfig } from "../src/config.ts";
import { makeFinding, reply } from "./helpers.ts";

const outcome = (...args: Parameters<typeof classify>) => classify(...args).outcome;

describe("classify", () => {
  it("addressed: code near the comment changed afterwards", () => {
    expect(outcome(makeFinding(), { "src/users.ts": [42] }, defaultConfig)).toBe("addressed");
  });

  it("addressed wins even if the thread was resolved", () => {
    expect(outcome(makeFinding({ isResolved: true }), { "src/users.ts": [39] }, defaultConfig)).toBe("addressed");
  });

  it("not addressed when the change is far from the comment", () => {
    expect(outcome(makeFinding(), { "src/users.ts": [90] }, defaultConfig)).toBe("ignored");
  });

  it("addressed: a 'good catch' reply plus a later change to the same file", () => {
    const finding = makeFinding({ replies: [reply("Good catch, thanks")] });
    expect(outcome(finding, { "src/users.ts": [200] }, defaultConfig)).toBe("addressed");
  });

  it("addressed: a 👍 plus a later change to the file, even with no patch", () => {
    const finding = makeFinding({ reactions: { up: 1, down: 0 } });
    expect(outcome(finding, { "src/users.ts": null }, defaultConfig)).toBe("addressed");
  });

  it("addressed: an explicit reply when no diff could be fetched", () => {
    const result = classify(makeFinding({ replies: [reply("Fixed in abc123")] }), null, defaultConfig);
    expect(result.outcome).toBe("addressed");
    expect(result.reason).toMatch(/no diff/);
  });

  it("not addressed: a 'fixed' reply but the file never changed", () => {
    const finding = makeFinding({ replies: [reply("fixed")] });
    expect(outcome(finding, {}, defaultConfig)).toBe("ignored");
  });

  it("dismissed: 👎 reaction", () => {
    expect(outcome(makeFinding({ reactions: { up: 0, down: 1 } }), {}, defaultConfig)).toBe("dismissed");
  });

  it("dismissed: a reply saying it's intentional", () => {
    const finding = makeFinding({ replies: [reply("This is intentional, the caller validates it.")] });
    expect(outcome(finding, {}, defaultConfig)).toBe("dismissed");
  });

  it("dismissed: resolved with no nearby change", () => {
    expect(outcome(makeFinding({ isResolved: true }), {}, defaultConfig)).toBe("dismissed");
  });

  it("outdated: GitHub marked it outdated but nothing nearby changed", () => {
    expect(outcome(makeFinding({ isOutdated: true }), { "src/users.ts": [300] }, defaultConfig)).toBe("outdated");
  });

  it("ignored: no response at all", () => {
    expect(outcome(makeFinding(), {}, defaultConfig)).toBe("ignored");
  });

  it("matches phrases as whole words only", () => {
    // "undone" must not match "done".
    const finding = makeFinding({ replies: [reply("this would be undone by the migration")] });
    expect(outcome(finding, { "src/users.ts": [200] }, defaultConfig)).toBe("ignored");
  });

  it("respects a custom proximity", () => {
    const config = { ...defaultConfig, proximity: 10 };
    expect(outcome(makeFinding(), { "src/users.ts": [50] }, config)).toBe("addressed");
  });

  it("handles comments with no line (file-level comments)", () => {
    expect(outcome(makeFinding({ line: null }), { "src/users.ts": [1] }, defaultConfig)).toBe("ignored");
  });
});
