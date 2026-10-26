# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create an issue with `gh issue create --title "..." --body "..."`.
- Read an issue with `gh issue view <number> --json number,title,body,labels,comments`.
- List issues with `gh issue list` and appropriate `--state` and `--label` filters.
- Apply labels with `gh issue edit <number> --add-label "..."`.
- Infer the repository from the git remote; this repository is `mohammadamer/copilot-orbit`.
- When a skill says to publish to the issue tracker, create a GitHub issue.

## Pull requests as a triage surface

**PRs as a request surface: no.** Do not treat external pull requests as feature requests unless this setting is deliberately changed.
