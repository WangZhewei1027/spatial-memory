# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues at `WangZhewei1027/spatial-memory`. Use the `gh` CLI from this repository root. For commands run elsewhere, pass `--repo WangZhewei1027/spatial-memory` explicitly.

Before the first write in a session, run `gh repo view --json nameWithOwner` and verify the target is `WangZhewei1027/spatial-memory`. Resolve a mismatch before writing. The skill source repository, `mattpocock/skills`, is not this project's tracker.

## Issue operations

- **Create:** `gh issue create --title "..." --body-file <path>`; write the exact Markdown body to a temporary UTF-8 file first.
- **Read:** `gh issue view <number> --json number,title,body,labels,comments`.
- **List:** `gh issue list --state open --json number,title,body,labels,comments`; add `--label` or change `--state` to narrow the query, and handle pagination when the full queue is needed.
- **Update the body:** `gh issue edit <number> --body-file <path>`.
- **Comment:** `gh issue comment <number> --body-file <path>`.
- **Change labels:** `gh issue edit <number> --add-label "..." --remove-label "..."`; use the role mapping in `triage-labels.md`.
- **Close:** post the explanation as a comment, then run `gh issue close <number>`. Add comments separately even when an issue is already closed.

When a skill says **publish to the issue tracker**, create a GitHub issue in this repository. When it says **fetch the relevant ticket**, read the referenced issue and its discussion.

## Parent tickets and dependencies

Use GitHub's native sub-issues and blocking relationships so the task graph is visible in the tracker:

- **Create a child:** `gh issue create --parent <parent> --title "..." --body-file <path>`.
- **Attach an existing child:** `gh issue edit <parent> --add-sub-issue <child>`.
- **Add blockers:** `gh issue edit <child> --add-blocked-by <blocker>`; on creation, use `gh issue create --blocked-by <n>,<n> ...`.
- **Count open blockers:** `gh api repos/WangZhewei1027/spatial-memory/issues/<number> --jq .issue_dependencies_summary.blocked_by`.

If native relationships are unavailable, put `Part of #<parent>` and `Blocked by: #<n>, #<n>` near the top of the child body, and maintain a child task list on the parent. A ticket is unblocked when every blocker is closed. If reading `blockedBy` via `gh issue view`, filter out closed blockers.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If a maintainer later changes this flag to `yes`, triage external PRs using the same roles from `triage-labels.md` and the `gh pr` equivalents. Read the PR body, comments, and diff before classifying it. GitHub issues and PRs share a number space; resolve a bare reference before applying issue-specific operations.

## Wayfinding operations

Used by `wayfinder`. The map is a GitHub issue with one child issue per ticket.

- **Map:** label it `wayfinder:map`; its body holds Notes, Decisions-so-far, and Fog.
- **Child:** link it as a sub-issue, or use the parent/body fallback above. Label its type `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- **Labels:** create a required `wayfinder:*` label if missing when first using this workflow.
- **Frontier:** read the map's children in map order; choose the first open, unassigned ticket with no open blocker.
- **Claim:** assign the ticket to the driving developer before starting: `gh issue edit <number> --add-assignee @me`.
- **Resolve:** comment with the answer, close the ticket, then append its gist and link to the map's Decisions-so-far section.
