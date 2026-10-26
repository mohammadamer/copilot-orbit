# Copilot Orbit

**Every discoverable Copilot session. Clear control where supported.**

Copilot Orbit is a VS Code extension for discovering Copilot CLI sessions and
managing only sessions that its supported SDK runtime can control.

## Features

- Browse sessions exposed by the Copilot SDK, sorted by recent activity and
  grouped by known project context. Filter All, Recent, Active, Pending,
  Completed, Failed, Favorites, and Archived sessions.
- Inspect source and runtime status without guessing. Live status remains
  **Unknown** until an explicit successful resume or a managed runtime event
  establishes it.
- Explicitly resume an existing session by its original ID and inspect its
  conversation history.
- Create sessions, send messages, steer an active run, or cancel a run.
- Review and answer run-scoped tool permission prompts and Copilot questions.
- Read sanitized GitHub-flavored Markdown with syntax-highlighted code, and
  page through conversation history four rounds at a time.
- Use local favorites and reversible archive markers. Transcript content and
  credentials are not persisted by the extension.
- Search session metadata, filter by source, copy session IDs, and open known
  project folders.
- Use the canonical dashboard and All Sessions, Projects, Active Sessions, and
  request-level Pending Approvals Activity Bar views. Pending requests are
  age-ordered and counted in the view badge.

## Runtime and compatibility

The extension uses `@github/copilot-sdk` and its bundled Copilot runtime by
default. It does not silently download or update a separate CLI. To use an
already-installed compatible CLI, set **Copilot Orbit: CLI Path** in extension
settings.

The SDK catalog distinguishes local from remote sessions; it does not reliably
identify the originating client or its live process. Resuming does not take over
another Copilot App, terminal, or SDK process. The extension resumes a session
only after explicit user action. Pending work is not replayed on resume. Plan
approval, session deletion, persistent
permission grants, telemetry, and cross-device synchronization are not
supported.

The SDK exposes conversation history through a full `getEvents()` result rather
than paged retrieval. Orbit loads that history on explicit resume, renders only
the latest four conversation rounds initially, and reveals earlier rounds on
demand. Conversation data remains in memory and is not written to extension
storage.

## Commands

- **Copilot Orbit: Open Dashboard**
- **Copilot Orbit: Refresh Sessions**
- **Copilot Orbit: Create Session**
- **Copilot Orbit: Resume Session**
- **Copilot Orbit: Copy Session ID**
- **Copilot Orbit: Open Project**
- **Copilot Orbit: Cancel Run**
- **Copilot Orbit: Show Pending Approvals**

Cancel Run asks for confirmation by default. It aborts the current run without
deleting or completing the session.
Closing the dashboard does not cancel a run. Shutting down VS Code stops the SDK
client, so active work may not continue.

## Development

Requires Node.js 20.19 or later and a compatible VS Code extension host.

```sh
npm install
npm run typecheck
npm test
npm run build
```

The extension-host facade is tested through an injected SDK boundary; tests do
not launch the Copilot runtime.
