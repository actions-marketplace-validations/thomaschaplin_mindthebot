# review-ledger

**Measure whether AI code review comments actually get acted on.**

Teams are adding AI reviewers to every pull request: Claude, Greptile, Copilot, CodeRabbit, Cursor Bugbot. Few teams measure whether those comments lead to anything. Without data, people who find a bot noisy can't prove it, people who like it can't prove it catches real issues, and nobody knows whether a prompt or model change made it better or worse.

`review-ledger` reads your merged PRs and scores every issue an AI reviewer raised, whether as an inline comment or as an item in a summary comment, as **addressed**, **dismissed** or **ignored**:

```bash
npx review-ledger --repo owner/name --since 30d
```

It's read-only and needs no setup inside the repo.

## Sample report

Eight well-known public repos, merged PRs from the last 30 days (up to 80 per repo), run on 16 Nov 2026:

| Reviewer | Where | PRs | Findings | Addressed | Dismissed | Ignored |
|---|---|---|---|---|---|---|
| Copilot | VS Code, supabase, cline, … | 103 | 152 | 79% | 20% | 1% |
| Greptile | cline, PostHog | 81 | 173 | 64% | 36% | 1% |
| CodeRabbit | supabase, TanStack Query, cal.com, … | 179 | 206 | 57% | 20% | 19% |
| Claude | anthropics/claude-code-action | 22 | 112 | 54% | 39% | 6% |

By severity, Greptile's P1s were addressed 73% of the time against 59% for P2s, and CodeRabbit's "major" 60% against 58% for "minor". The full report also covers time to merge with and without AI findings, and the files where findings get dismissed most.

These numbers describe how each team responds to its reviewer, not which reviewer is "best": teams, codebases and settings differ.

## How it decides

For each AI comment, it compares the commit the comment was made on with the PR's final commit:

- **Addressed:** code within 3 lines of the comment changed afterwards, or someone replied "fixed" / "good catch" (or gave a 👍) and the file changed.
- **Dismissed:** a 👎, a reply like "intentional" or "false positive", or the thread was resolved with no nearby change.
- **Ignored:** no reply, reaction, resolution or nearby change.
- **Not addressed:** for issues listed in a summary comment, which have no replies or resolution: no nearby change.

Summary comments are parsed for numbered items with a severity and a `file:line`, such as `claude-code-action`'s sticky "Code Review -- 2 issue(s) found" comment. Re-reviews that repeat an open issue are merged, and the issue is checked from the last review that repeated it. Results are also broken down by the severity each reviewer gave (P1/P2, warning/note, and so on).

Every finding in the JSON output includes the rule that decided it, so any number can be audited. These are heuristics, and they have limits: a nearby change isn't proof of cause, and fixes made in another PR look ignored. **[docs/heuristics.md](docs/heuristics.md)** explains the rules, the known limits, and how to check them against your own labels.

## Usage

```bash
# Token: GITHUB_TOKEN, or your GitHub CLI login (`gh auth login`). Read-only access is enough.
npx review-ledger --repo owner/name                       # markdown, last 30 days
npx review-ledger --repo owner/a,owner/b --since 2w       # several repos
npx review-ledger --repo owner/name --format json -o ledger.json
npx review-ledger --repo owner/name --config review-ledger.yml
npx review-ledger --repo owner/name --datadog             # also send gauges to Datadog
```

| Option | Default | |
|---|---|---|
| `--repo` | required | `owner/name`, repeatable or comma-separated |
| `--since` | `30d` | `12h`, `30d`, `2w` |
| `--max-prs` | `200` | per repo |
| `--config` | built-in | YAML: bots, proximity, phrases. See [review-ledger.example.yml](review-ledger.example.yml) |
| `--format` | `md` | `md` or `json` |
| `--out` | stdout | write to a file |
| `--datadog` | off | DogStatsD gauges such as `review_ledger.addressed_rate{bot,repo}`; needs `hot-shots` and a Datadog agent. No comment text is sent. |
| `--no-cache` | cache on | API responses are cached in `.review-ledger/cache/` |

### Supported reviewers (built in)

Claude (`claude[bot]`, or `github-actions[bot]` comments that mention Claude), Greptile, Copilot, CodeRabbit and Cursor Bugbot. You can add any other bot login in the config.

## GitHub Action

Run it on a schedule and publish the report as a job summary, a living issue, or both:

```yaml
name: AI review ledger
on:
  schedule:
    - cron: "0 8 * * 1"   # Mondays
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read
  issues: write           # only needed for output: issue

jobs:
  ledger:
    runs-on: ubuntu-latest
    steps:
      - uses: thomaschaplin/review-ledger@v1
        with:
          since: 7d
          output: job-summary,issue
```

| Input | Default | |
|---|---|---|
| `repos` | current repo | `owner/name`, comma- or newline-separated |
| `since` | `7d` | `12h`, `7d`, `2w` |
| `max-prs` | `200` | per repo |
| `config` | built-in | path to a YAML config |
| `output` | `job-summary` | `job-summary`, `issue`, `none` (comma-separated) |
| `issue-title` | `AI review ledger` | an open issue with this title and the `review-ledger` label is updated instead of creating a new one |
| `issue-repo` | current repo | where to post the issue |
| `github-token` | `${{ github.token }}` | use a PAT or GitHub App token to read other private repos |

Outputs: `markdown-path`, `json-path`, `findings`, `by-bot` (JSON of per-reviewer rates, handy for gating or alerting in a later step) and `issue-url`. The full JSON ledger is written to `review-ledger.json`, so you can upload it with `actions/upload-artifact`.

This repo runs the Action on itself every week: see [.github/workflows/ledger.yml](.github/workflows/ledger.yml).

## Development

```bash
npm install
npm test            # vitest: classifier rules, diff parsing, a fixture-based pipeline test
npm run typecheck
npm run dev -- --repo owner/name   # run from source (Node 22.18+)
npm run build       # bundle the CLI (dist/cli.js) and the Action (action/dist/index.js)
npm run check-dist  # rebuild and fail if the committed Action bundle is out of date (CI runs this)
```

## Roadmap

- [x] GitHub Action: a weekly report as a job summary or an issue
- [ ] A 30-finding hand-labelled agreement check, with the rate published here
- [x] Score issues listed in summary comments, with severity breakdown
- [ ] Group findings by category (bug, security, style)
- [ ] Pair with an eval harness of planted bugs, to measure what reviewers *miss*, not just what they say

## Licence

MIT
