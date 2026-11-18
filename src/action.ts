import { writeFile } from "node:fs/promises";
import * as core from "@actions/core";
import { Cache } from "./collect/cache.ts";
import { createClient, splitRepo } from "./collect/github.ts";
import { loadConfig } from "./config.ts";
import { renderMarkdown } from "./report/markdown.ts";
import { run } from "./run.ts";
import { parseDuration } from "./util/duration.ts";
import { listInput, parseOutputs } from "./action-inputs.ts";

async function main(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  core.setSecret(token);

  const repos = listInput(core.getInput("repos") || process.env.GITHUB_REPOSITORY || "");
  if (repos.length === 0) throw new Error("No repos given, and GITHUB_REPOSITORY isn't set.");
  repos.forEach(splitRepo);

  const since = core.getInput("since") || "7d";
  parseDuration(since);
  const maxPrs = Number(core.getInput("max-prs") || "200");
  if (!Number.isInteger(maxPrs) || maxPrs < 1) throw new Error("max-prs must be a positive whole number.");

  const outputs = parseOutputs(core.getInput("output") || "job-summary");
  const config = await loadConfig(core.getInput("config") || undefined);
  const client = createClient(token);

  const ledger = await run(client, new Cache(".mindthebot/cache", false), config, {
    repos,
    since,
    maxPrs,
    log: (m) => core.info(m),
  });
  const markdown = renderMarkdown(ledger);

  const markdownPath = core.getInput("markdown-path") || "mindthebot.md";
  const jsonPath = core.getInput("json-path") || "mindthebot.json";
  await writeFile(markdownPath, markdown);
  await writeFile(jsonPath, `${JSON.stringify(ledger, null, 2)}\n`);
  core.setOutput("markdown-path", markdownPath);
  core.setOutput("json-path", jsonPath);
  core.setOutput("findings", ledger.findings.length);
  core.setOutput(
    "by-bot",
    JSON.stringify(
      Object.fromEntries(
        ledger.byBot.map((s) => [
          s.bot,
          {
            findings: s.findings,
            addressedRate: s.addressedRate,
            dismissedRate: s.dismissedRate,
            acknowledgedRate: s.acknowledgedRate,
            ignoredRate: s.ignoredRate,
            notAddressedRate: s.notAddressedRate,
          },
        ]),
      ),
    ),
  );

  if (outputs.includes("job-summary")) {
    await core.summary.addRaw(markdown).write();
  }
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
