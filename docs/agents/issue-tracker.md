# Issue tracker: GitHub

Issues and specifications for this repository live in GitHub Issues. Use the
`gh` CLI for issue operations and infer the repository from its Git remote.
Follow the current workspace's GitHub identity and invocation rules. Examples
below show the inner `gh` commands; they do not override workspace rules.

## Conventions

- Create an issue with `gh issue create --title "..." --body "..."`.
- Read an issue with `gh issue view <number> --comments` and fetch its labels.
- List issues with `gh issue list --state open --json number,title,body,labels,comments`.
- Comment with `gh issue comment <number> --body "..."`.
- Add or remove labels with `gh issue edit <number> --add-label "..."` or
  `--remove-label "..."`.
- Close an issue with `gh issue close <number> --comment "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.** This repository does not treat external pull
requests as feature requests. Change this setting only if that policy changes.

## Skill routing

When a skill says to publish work to the issue tracker, create a GitHub issue.
When a skill says to fetch a ticket, run `gh issue view <number> --comments`.
