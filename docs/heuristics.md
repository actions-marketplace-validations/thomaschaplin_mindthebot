# How review-ledger classifies findings

A **finding** is the first comment of a pull request review thread, written by a configured AI reviewer. Replies from other bots are ignored; replies from people are kept.

For each finding, review-ledger compares the commit the comment was made on with the PR's final head commit (`GET /repos/{owner}/{repo}/compare/{base}...{head}`). It then works out which lines of the commented file changed afterwards, in the coordinates of the commented commit.

## Rules

The first rule that matches wins.

| # | Outcome | Rule |
|---|---|---|
| 1 | addressed | A line within `proximity` (default 3) of the commented line changed after the comment. |
| 2 | addressed | A person replied with an "addressed" phrase or gave the comment a 👍, **and** the file changed after the comment. |
| 2b | addressed | The same as rule 2, but the diff couldn't be fetched (for example after a force-push), so the reply is taken at its word. |
| 3 | dismissed | The comment got a 👎. |
| 4 | dismissed | A person replied with a "dismissed" phrase. |
| 5 | dismissed | The thread was resolved with no nearby change. |
| 6 | outdated | GitHub marked the thread outdated, but no nearby change was found. |
| 7 | ignored | None of the above. |

Each classified finding in the JSON output carries a `reason` field saying which rule matched, so you can audit any number.

### Changed lines
- A deleted or replaced line counts as changed.
- A pure insertion counts as changing the old lines either side of it.
- A file that changed but has no patch (binary, or too large for the API) counts as changed for rule 2, but not for rule 1.

## Limits

These are heuristics. They are cheap, explainable and mostly right, but not always.

- **Nearby isn't the same as caused by.** A change near the comment might be unrelated. Rule 1 can overcount "addressed", especially on busy files.
- **Merging the base branch into the PR** brings in other people's changes. The comparison can then show nearby changes the author didn't make.
- **Force-pushes** can make the commented commit unreachable. Those findings fall back to replies and reactions.
- **Fixes made in a different PR** look ignored or dismissed.
- **Resolving a thread is ambiguous.** Some teams resolve threads to tidy up after fixing something elsewhere in the PR. Rule 5 counts that as dismissed.
- **Summary comments** (review bodies and PR conversation comments) are counted, not classified.
- **Phrase matching** is English-only and naive: "not done" matches "done".

## Checking the heuristics

Before trusting the numbers for a repo:

1. Run with `--format json`.
2. Take a random sample of about 30 findings.
3. Label each one by hand, reading the thread and the diff.
4. Compare your labels with the tool's `outcome`, and adjust `proximity` and the phrase lists in your config.

A first spot-check of 6 random findings on `anthropics/claude-code-action` (16 Nov 2026) agreed with the tool every time. That's too small a sample to quote as an agreement rate; a 30-finding check is still to do.
