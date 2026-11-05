# Usage guide

Copilot Orbit helps you manage GitHub Copilot sessions without leaving VS Code. The extension gives you a session dashboard, approval controls, and direct access to session state for local and remote Copilot workflows.

## Quick start

1. Install the extension from the VS Code Marketplace.
2. Open the Command Palette and run `Copilot Orbit: Open Dashboard`.
3. Select a session from the dashboard or create a new one.
4. Use the activity bar to focus on active sessions, projects, or pending approvals.
5. Click a session to inspect messages and respond to requests.

## Typical flows

### Open and inspect a session

- Open the dashboard from the command palette or the activity bar.
- Browse by project, recent activity, or status.
- Click a session to open the detailed conversation view.
- If a session is incomplete or waiting for permission, the pending approvals panel will highlight it.

### Create a new session

- Run `Copilot Orbit: Create Session`.
- Select the working directory if prompted.
- The new instance appears in the dashboard immediately.
- Send a prompt to continue work or ask for a follow-up.

### Respond to approval requests

- Watch the Pending Approvals panel.
- Click the approval request.
- Choose approve or deny based on the request details.
- The extension keeps the permission flow visible without leaving the editor context.

### Resume work from an earlier session

- Use `Copilot Orbit: Resume Session`.
- Pick the session from the catalog.
- Resume opens the session and loads the relevant history.
- Continue the conversation without starting from scratch.

## Common commands

| Command | What it does |
| --- | --- |
| `Copilot Orbit: Open Dashboard` | Opens the main dashboard |
| `Copilot Orbit: Refresh Sessions` | Refreshes the session catalog |
| `Copilot Orbit: Create Session` | Starts a new Copilot session |
| `Copilot Orbit: Resume Session` | Reconnects to an existing session |
| `Copilot Orbit: Copy Session ID` | Copies a session identifier |
| `Copilot Orbit: Cancel Run` | Stops a running operation |
| `Copilot Orbit: Show Pending Approvals` | Focuses the approval panel |

## Recommended workflow

For day-to-day work, use the dashboard as a control center:

- keep the activity bar visible,
- trust the session filters,
- check pending approvals before switching context,
- resume a session when you need historical context,
- cancel only when the runtime is clearly stuck.

## Known usage limits

- Some sessions may appear as visible but not controllable.
- Runtime capabilities depend on the Copilot SDK and session type.
- Steering and resume behavior can vary by runtime version.
- The extension does not persist transcripts in local storage.

## Troubleshooting

If a session does not appear:

1. Refresh the session list.
2. Check whether the underlying Copilot runtime is available.
3. Confirm the CLI path setting if you use a custom runtime.
4. Restart the extension host if the dashboard appears stale.

If a run is stuck:

1. Confirm you are targeting the correct session.
2. Use `Cancel Run` only when appropriate.
3. Resume the session if the runtime supports it.
