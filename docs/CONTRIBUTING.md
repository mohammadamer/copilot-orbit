# Contributing

Thanks for helping improve Copilot Orbit.

## Before you start

- Keep changes focused and easy to review.
- Prefer small, clear pull requests.
- Match the existing project structure and conventions.

## Local setup

```bash
git clone https://github.com/mohammadamer/copilot-orbit.git
cd copilot-orbit
npm install
```

## Development workflow

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

## Coding guidelines

- Add TypeScript types for public APIs.
- Keep extension logic separate from UI concerns.
- Avoid persisting sensitive data or transcripts.
- Preserve the existing message protocol when touching webview or facade interactions.
- Write tests for bug fixes and new runtime behaviors when practical.

## Pull request checklist

- Branch is based on a current main or default branch.
- Documentation is updated when behavior changes.
- Build, typecheck, lint, and tests pass.
- The PR explains the bug fix or feature in user-facing terms.

## Commit expectations

Follow Conventional Commits, for example:

- `feat: add dashboard filters`
- `fix: handle missing pending approval state`
- `docs: improve install and usage guidance`

## Reporting issues

When reporting a bug or feature gap:

- include the VS Code version,
- include the extension version,
- describe the exact command or workflow,
- note any relevant session state or runtime errors,
- attach logs when possible.

## Need help?

Open a GitHub issue or start a discussion in the repository before broad refactors. This keeps work aligned with the extension's runtime limits and UX goals.
