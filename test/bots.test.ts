import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { detectBot, isBotLogin } from "../src/detect/bots.ts";

describe("detectBot", () => {
  it("matches logins with or without the [bot] suffix, case-insensitively", () => {
    expect(detectBot(defaultConfig.bots, "greptile-apps", "x")).toBe("Greptile");
    expect(detectBot(defaultConfig.bots, "Greptile-Apps[bot]", "x")).toBe("Greptile");
  });

  it("uses the body pattern for shared logins like github-actions", () => {
    expect(detectBot(defaultConfig.bots, "github-actions", "**Claude finished** reviewing")).toBe("Claude");
    expect(detectBot(defaultConfig.bots, "github-actions", "Coverage report: 81%")).toBeNull();
  });

  it("ignores humans and missing authors", () => {
    expect(detectBot(defaultConfig.bots, "octocat", "looks good")).toBeNull();
    expect(detectBot(defaultConfig.bots, null, "x")).toBeNull();
  });
});

describe("isBotLogin", () => {
  it("treats any configured login as a bot, regardless of body", () => {
    expect(isBotLogin(defaultConfig.bots, "github-actions[bot]")).toBe(true);
    expect(isBotLogin(defaultConfig.bots, "octocat")).toBe(false);
  });
});
