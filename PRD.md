# Build a Production-Ready VS Code Extension for GitHub Copilot Session Management

## 1. Role and Objective

Act as a senior VS Code extension architect, TypeScript engineer, React developer, and GitHub Copilot SDK specialist.

Your task is to design and implement a complete, production-quality Visual Studio Code extension that provides a centralized interface for discovering, browsing, monitoring, resuming, and interacting with GitHub Copilot sessions.

The extension should provide a unified session-discovery and management experience across projects, workspaces, and conversations, using only capabilities exposed by the official `@github/copilot-sdk`.

The product should bring the experience of a modern Copilot session dashboard directly into VS Code.

This is not just a UI implementation. Build the complete extension, including:

- VS Code extension activation and lifecycle.
- Session discovery and management.
- Copilot SDK integration.
- SDK-provided CLI runtime integration, with an explicit override for an existing user-installed CLI.
- Session resumption and interaction.
- Streaming conversation experience.
- Tool permission management.
- SDK-supported interactive questions; plan responses only if a documented public SDK API is verified.
- Working timeline and activity monitoring.
- Workspace and project organization.
- Persistent user preferences.
- Error handling and recovery.
- Secure configuration and logging.
- Responsive, accessible UI.
- Automated tests and documentation.

The final result must be installable and usable as a real VS Code extension.

---

# 2. Technical Requirements

## 2.1 Technology Stack

Use the following technologies:

**Extension backend**
- TypeScript.
- VS Code Extension API.
- Official `@github/copilot-sdk`.
- The CLI runtime supplied by the official Node SDK by default, with an explicit override for a compatible user-installed CLI.
- Node.js APIs where appropriate.
- Zod for runtime validation of external data and configuration.
- VS Code SecretStorage for sensitive information, if needed.
- VS Code workspace/global state for user preferences and lightweight persistence.

**Frontend**
- React.
- TypeScript.
- VS Code Webview API.
- VS Code Webview UI Toolkit where appropriate, or native VS Code theme-aware components.
- Modern CSS.
- Markdown rendering with safe GitHub-flavored Markdown support.
- Syntax highlighting for code blocks.

**Build and development**
- esbuild or another suitable VS Code extension bundler.
- npm.
- ESLint.
- Prettier.
- Vitest or Jest.
- VS Code Extension Test Runner.
- `@vscode/vsce` for packaging.

Use stable, compatible versions. Inspect the current repository and dependency versions before making changes.

Do not introduce unnecessary dependencies.

## 2.2 SDK and API Validation

Before implementing SDK functionality:

1. Inspect the installed `@github/copilot-sdk` package.
2. Read its TypeScript definitions and official documentation.
3. Identify the actual session discovery, event, resume, continuation, and interaction APIs.
4. Identify which capabilities are supported by the installed GitHub Copilot CLI version.
5. Verify the SDK's documented session catalog and its source coverage.
6. Verify the actual event types and payload schemas.
7. Verify how SDK-managed web runs handle pending work, permissions, questions, plans, and steering.
8. Implement against real APIs only.

Do not invent SDK methods, event names, CLI flags, or session-store schemas.

If an API differs from the expected behavior described in this specification, adapt the implementation to the real API and document the difference.

Do not use private APIs, reverse-engineered endpoints, or unsupported filesystem modifications.

### Verified capability baseline (2026-10-26)

The workspace initially contained no SDK dependency, package manifest, lockfile, or SDK type declarations. The locally available Copilot CLI was version 1.0.103. Official Node SDK documentation for `@github/copilot-sdk` 1.0.26 documents `CopilotClient.listSessions`, `CopilotSession.getEvents`, `CopilotClient.resumeSession`, session/lifecycle event subscriptions, permission handlers, legacy and structured elicitation handlers, steering through `session.send({ mode: "immediate" })`, `CopilotSession.abort`, and session disconnection/resumption. These documented APIs still require verification against the package and declarations selected for implementation.

The official Node SDK documentation describes an optional platform package that supplies the CLI runtime without downloading it at runtime, and supports an explicit local CLI path override. Use that SDK-provided runtime by default; allow a user-configured existing CLI override. Do not silently download, install, or update a runtime after extension installation.

The SDK's documented session metadata does not establish every originating client or provide a reliable live status for every discovered session. Display only facts supplied by the API and use `Unknown` otherwise. Plan-response interactions are not documented as a public SDK API. Some pending-work continuation and pause mechanics are explicitly described as internal runtime behavior, so do not promise or recreate them. Session discovery and resumption through documented APIs are release gates; unsupported secondary interactions must be omitted rather than simulated.

Documentation references: [Node.js SDK README](https://github.com/github/copilot-sdk/blob/c57638f4a7ce2255a34192d5035932d0e109bbdd/nodejs/README.md), [session persistence](https://github.com/github/copilot-sdk/blob/c57638f4a7ce2255a34192d5035932d0e109bbdd/docs/features/session-persistence.md), and [steering and queueing](https://github.com/github/copilot-sdk/blob/c57638f4a7ce2255a34192d5035932d0e109bbdd/docs/features/steering-and-queueing.md). Reverify these facts against the package version actually installed before implementation.

---

# 3. Product Concept and User Experience

Create an extension named:

**Copilot Orbit**

Suggested extension identifier:

`copilot-orbit`

Suggested command prefix:

`copilotSessions`

The extension should provide a dedicated activity bar view and a full-featured session-management interface.

Users should be able to:

- Discover their Copilot projects and sessions.
- Browse conversations across projects.
- Search and filter sessions.
- View session details and conversation history.
- Resume supported sessions.
- Start new sessions.
- Interact with active sessions.
- Monitor agent activity.
- Approve or reject tool permissions.
- Answer Copilot questions.
- Steer running sessions.
- Manage session-specific settings (deferred from v1; no concrete controls are defined).
- Open the associated project or workspace.
- Understand whether a session is actively controllable or only available for viewing.

The interface should feel native to VS Code, while providing a richer experience than a standard TreeView.

---

# 4. VS Code Extension Architecture

Implement a modular architecture with a clear separation between the extension host and webview frontend.

Recommended structure:

```text
copilot-orbit/
│
├── package.json
├── tsconfig.json
├── esbuild.js
├── .vscodeignore
├── README.md
├── CHANGELOG.md
│
├── src/
│   ├── extension.ts
│   │
│   ├── commands/
│   │   ├── commandRegistry.ts
│   │   ├── openDashboard.ts
│   │   ├── refreshSessions.ts
│   │   ├── resumeSession.ts
│   │   ├── createSession.ts
│   │   ├── stopSession.ts
│   │   └── openProject.ts
│   │
│   ├── providers/
│   │   ├── SessionTreeProvider.ts
│   │   ├── ProjectTreeProvider.ts
│   │   └── SessionStatusProvider.ts
│   │
│   ├── services/
│   │   ├── CopilotSdkService.ts
│   │   ├── CopilotCliService.ts
│   │   ├── SessionDiscoveryService.ts
│   │   ├── SessionManagerService.ts
│   │   ├── SessionResumeService.ts
│   │   ├── SessionInteractionService.ts
│   │   ├── SessionEventService.ts
│   │   ├── PermissionService.ts
│   │   ├── ProjectService.ts
│   │   ├── SettingsService.ts
│   │   └── LoggingService.ts
│   │
│   ├── models/
│   │   ├── Session.ts
│   │   ├── Project.ts
│   │   ├── Conversation.ts
│   │   ├── CopilotEvent.ts
│   │   ├── Permission.ts
│   │   ├── Question.ts
│   │   └── SessionStatus.ts
│   │
│   ├── webview/
│   │   ├── DashboardPanel.ts
│   │   ├── WebviewMessageRouter.ts
│   │   └── WebviewProvider.ts
│   │
│   ├── security/
│   │   ├── MessageValidator.ts
│   │   ├── WebviewSecurity.ts
│   │   └── PermissionPolicy.ts
│   │
│   └── utils/
│       ├── markdown.ts
│       ├── eventGrouping.ts
│       ├── cancellation.ts
│       └── pathUtils.ts
│
├── webview-ui/
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── Sidebar/
│   │   │   ├── SessionList/
│   │   │   ├── SessionCard/
│   │   │   ├── ChatView/
│   │   │   ├── ChatMessage/
│   │   │   ├── ChatComposer/
│   │   │   ├── WorkingTimeline/
│   │   │   ├── PermissionCard/
│   │   │   ├── QuestionCard/
│   │   │   ├── ProjectHeader/
│   │   │   ├── SearchBar/
│   │   │   ├── FilterBar/
│   │   │   ├── EmptyState/
│   │   │   └── SettingsPanel/
│   │   ├── hooks/
│   │   │   ├── useSessions.ts
│   │   │   ├── useConversation.ts
│   │   │   ├── useSessionEvents.ts
│   │   │   └── useWebviewMessaging.ts
│   │   ├── services/
│   │   │   └── vscodeApi.ts
│   │   ├── styles/
│   │   │   ├── theme.css
│   │   │   ├── dashboard.css
│   │   │   └── chat.css
│   │   └── types/
│   │       └── messages.ts
│   │
│   └── tsconfig.json
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── extension/
│
└── resources/
    ├── icons/
    └── screenshots/
```

You may adjust the structure when necessary, but maintain clear separation between the UI, SDK integration, session management, and VS Code APIs.

Do not place all functionality in one large extension.ts file.

---

# 5. Session Discovery and Project Management

## 5.1 SDK Session Catalog

Use the official Copilot SDK's documented session-listing API to discover the sessions it exposes. Do not assume the API includes every Copilot client or every session in an underlying store.

Display sessions associated with sources only when the SDK exposes them. Do not promise particular client coverage unless documented. Use documented local/remote distinctions when available and label an unknown origin as **Unknown source**.

Include all sessions returned by the documented API across projects, not only the active workspace. Use session context such as working directory, repository, or branch only when available.

The extension must not assume every discovered session is attachable or controllable.

Build a normalized internal session model.

Example:

```ts
interface CopilotSession {
  id: string;
  sessionId: string;
  displayName: string;
  summary?: string;

  projectId?: string;
  projectName?: string;
  workspacePath?: string;

  source: "local" | "remote" | "unknown";

  createdAt?: string;
  updatedAt?: string;

  status:
    | "idle"
    | "running"
    | "waiting-for-permission"
    | "waiting-for-question"
    | "completed"
    | "failed"
    | "unknown";

  controlCapability:
    | "controllable"
    | "resumable"
    | "read-only"
    | "unknown";

  canResume: boolean;
  canSteer: boolean;

  model?: string;
  workingDirectory?: string;

  messageCount?: number;
}
```

This is an internal application model. Map it to actual SDK types rather than assuming the SDK returns these exact properties. Use the SDK summary as the display name when available; otherwise use a neutral short session ID. Do not invent titles from transcript content. Preserve `Unknown` for source, status, or capability when the API cannot establish them.

## 5.2 Project Grouping

Group sessions by project or workspace.

The sidebar should support:

- All sessions.
- Recent sessions.
- Active sessions.
- Pending approvals.
- Completed sessions.
- Failed sessions.
- Projects.
- Favorites.
- Archived sessions.

Project grouping should be based on reliable workspace/project metadata.

If the SDK does not expose a project name, use a safe folder-name fallback when a reliable path exists; otherwise group under an unknown project.

Never infer project ownership from an unreliable session title.

Default to All Sessions, sorted by most recent activity. Show status-specific categories only when status is established by documented metadata or a managed runtime; do not infer a live status from timestamps.

Favorites and archive state are local UI metadata keyed by session ID. Archive is reversible and does not change or delete the underlying Copilot session. Archived sessions with active runs or pending interactions must still appear in Active and Pending Approvals, marked as archived. Opening an archived session does not unarchive it. If a session disappears from the SDK catalog, retain only its ID and local favorite/archive flags as an unavailable entry, with an action to remove that local metadata.

## 5.3 Session List

Each session item should display:

- Display name (SDK summary, or a neutral short session ID).
- Project name.
- Last activity.
- Status indicator.
- Source indicator.
- Optional model information or message count only if provided by the SDK.

Provide context actions:

- Open session.
- Resume session.
- Open project.
- Copy session ID.
- Add/remove favorite.
- Archive locally.
- Unarchive.
- Refresh.

Do not rename, delete, or otherwise mutate sessions in the underlying Copilot store in v1. Display a safe project/folder name in ordinary rows; expose a full local path only in details or through an explicit Open Project/Copy Path action.

## 5.4 Search and Filtering

Implement:

- Search by SDK-provided summary/display name.
- Search by project.
- Search by session UUID.
- Filter by status.
- Filter by source.
- Filter by project.
- Sort by most recent activity.
- Sort by creation date.
- Sort alphabetically.

Support debounced search.

Search session metadata only in v1. Do not index or search conversation content across sessions.

Preserve the selected session and current filters during refreshes. Refresh on activation and manual request, consume lifecycle events where available, and use a configurable 30-second fallback poll by default only for changes not covered by events.

---

# 6. Main Dashboard UI

Build a polished, professional dashboard optimized for developer productivity.

## 6.1 Layout

Use a three-part desktop layout:

**Left sidebar**
- Projects.
- Session categories.
- Favorites.
- Recent sessions.
- Search and filters.

**Center area**
- Session list when no conversation is selected.
- Conversation view when a session is selected.

**Optional details panel**
- Session metadata.
- Project information.
- Runtime state.
- Model information.
- Session capabilities.
- Activity summary.

Allow the details panel to collapse.

The extension host is the sole control plane for SDK/CLI access, permission handling, session ownership, and authoritative state. The webview is presentation-only and communicates through a validated, typed message bridge.

Avoid excessive borders, cards, and visual noise.

## 6.2 VS Code Theme Integration

Support:

- VS Code Dark.
- VS Code Light.
- High Contrast Dark.
- High Contrast Light.

Use CSS variables based on VS Code theme tokens.

Examples:

```css
var(--vscode-editor-background)
var(--vscode-editor-foreground)
var(--vscode-sideBar-background)
var(--vscode-sideBar-foreground)
var(--vscode-button-background)
var(--vscode-button-foreground)
var(--vscode-input-background)
var(--vscode-input-foreground)
var(--vscode-focusBorder)
var(--vscode-descriptionForeground)
```

The extension should automatically adapt to the active VS Code theme.

Do not hardcode a single visual theme.

## 6.3 Activity Bar and Tree Views

Register an Activity Bar container named Copilot Sessions.

Provide TreeViews for:

- Projects.
- Sessions.
- Active sessions.
- Pending approvals.

Clicking a session should open it in the dashboard.

Provide a command to open the full dashboard.

The extension should remain useful even if the user prefers TreeViews over the dashboard.

Reuse a single dashboard panel. Pending interactions remain separately visible in the Pending Approvals TreeView, with a visible count/badge and no interruptive popup by default. List each request separately with its session identity/status, ordered by age. Opening one request must not resolve or hide other pending requests.

---

# 7. Conversation and Chat Experience

## 7.1 Conversation Rendering

Display the conversation history for the selected session.

Support:

- User messages.
- Assistant responses.
- Tool activity summaries.
- Permission requests.
- Interactive questions.
- Plan-response UI only if a documented public SDK API is verified.
- System/status messages where appropriate.

Consecutive Copilot assistant events should be grouped into a single logical assistant response.

Avoid displaying multiple fragmented assistant bubbles for what is effectively one response.

Preserve chronological ordering.

Use stable event IDs where available.

## 7.2 Safe Markdown Rendering

Render GitHub-flavored Markdown safely.

Support:

- Headings.
- Paragraphs.
- Ordered lists.
- Unordered lists.
- Nested lists.
- Links.
- Tables.
- Blockquotes.
- Inline code.
- Fenced code blocks.
- Syntax highlighting.
- Task lists.

Security requirements:

- Sanitize rendered HTML.
- Disable arbitrary HTML execution.
- Validate external links.
- Open external links through VS Code's safe external-link mechanism.
- Prevent script injection.
- Do not render untrusted HTML directly.

## 7.3 Conversation Pagination

Do not render the complete conversation immediately when a session contains a large history.

Initial behavior:

- Display the latest four conversation rounds.
- Show a Load more button.
- Each click reveals four earlier conversation rounds.
- Preserve the user's current reading position when older messages are inserted.
- Avoid scrolling automatically when the user is reading older content.
- When new messages arrive, scroll to the bottom only if the user is already near the bottom.

A conversation round should represent a logical user interaction and its associated assistant response, not simply an arbitrary number of SDK events.

If the SDK event stream contains fragmented assistant messages, group them before applying pagination.

The SDK currently returns session history through a full event list rather than a paged API. Load history only on explicit session resume, then paginate what the UI renders; do not claim that older events are fetched on demand. Adopt SDK-level paging if it becomes available.

## 7.4 Chat Composer

Provide a composer with:

- Multiline input.
- Send button.
- Keyboard shortcuts.
- Disabled/loading states.
- Error feedback.
- Clear input behavior after successful submission.
- Optional attachment support only if the SDK supports it.

Keyboard behavior:

- Enter: send.
- Shift+Enter: new line.
- Escape: cancel or dismiss the current interaction where appropriate.

Do not send messages when a required permission or question interaction is pending. Apply equivalent restrictions to any additional interaction only when the SDK documents it.

---

# 8. Session Resumption and Runtime Control

This is one of the most important parts of the extension.

## 8.1 Resume Existing Sessions

When a user selects Resume:

1. Verify that the session is supported by the SDK.
2. Check whether it is already managed by this extension.
3. Check for pending work only through documented SDK capabilities.
4. Use the SDK's supported resume mechanism.
5. Restore available conversation history.
6. Subscribe to the session event stream.
7. Update the UI.
8. Allow the user to interact with the resumed session.

Use the session UUID as the session identity.

Do not create a new session when the user intends to resume an existing one.

## 8.2 Distinguish Visible from Controllable Sessions

A critical product requirement:

The SDK's session catalog may contain sessions created by different Copilot clients.

Being able to discover or read a session does not mean the extension can attach to the original running process.

Implement explicit capability states:

- **Controllable:** The session is currently managed by this extension's SDK runtime.
- **Resumable:** The documented SDK supports resuming the session by its existing ID.
- **Read-only:** The session can be inspected, but cannot be controlled through this extension.
- **Unknown:** The runtime has not established its capabilities.

Display these capabilities clearly.

Resuming continues the same conversation with the same session ID; it does not claim to take over the original client's process. Never claim control of a separately running Copilot App, terminal CLI, or other SDK client merely because its session ID is visible. If origin cannot be established from documented metadata, display **Unknown source**.

## 8.3 Pending Work Continuation

When resuming an existing session:

- Restore pending execution only when the documented SDK can verify and support it.
- Otherwise restore available history and clearly state that pending work may not continue.
- Reconnect to the supported event stream.
- Display the current runtime status.
- Handle continuation errors gracefully.

If the original process is not attachable, explain that the session remains under the control of its original client.

Offer read-only inspection where possible.

## 8.4 Session Lifecycle

Support only lifecycle operations exposed by the documented SDK:

- Start new session.
- Resume session.
- Send message.
- Steer active run.
- Cancel active run.
- Refresh session state.

Do not expose session completion or deletion in v1. If the user selects Resume for a session already managed by this extension, focus the existing runtime instead of creating a duplicate. Allow multiple managed sessions only when the SDK safely supports them; otherwise enforce and explain its actual limit. New sessions use the unambiguous active workspace folder, or prompt for a folder when there are zero or multiple folders. Assign explicit session IDs to newly created sessions so they can be resumed later.

On extension-host shutdown, stop the SDK client and preserve resumable session data. Do not promise an in-flight run continues through shutdown. After an uncertain crash or restart, show live status as Unknown, never replay the last user message automatically, and require an explicit Resume action.

Cancel Run aborts only the active run using a documented SDK operation; it does not delete or complete the session. Confirm cancellation by default.

---

# 9. Streaming and Event Management

Build a centralized event-processing service.

The service should:

1. Subscribe to SDK session events.
2. Normalize incoming events.
3. Validate event payloads.
4. Group related assistant events.
5. Update the internal session state.
6. Update the conversation.
7. Update the Working timeline.
8. Notify the frontend through webview messages.

Handle:

- Streaming assistant responses.
- Assistant message completion.
- Tool invocation lifecycle.
- Tool completion.
- Permission requests.
- User questions.
- Plan-related events only when they are documented, user-facing SDK data; do not expose plan-response controls without a documented API.
- Session idle.
- Session completion.
- Session errors.
- Cancellation.
- Runtime disconnection.

Do not assume event delivery is always ordered or exactly once.

Implement:

- Event deduplication where stable identifiers are available.
- Safe handling of repeated events.
- Cancellation support.
- Subscription cleanup.
- Reconnection/recovery where supported.
- Protection against stale session updates.

Do not allow events from one session to leak into another session's UI.

---

# 10. Permission Management

SDK-managed web runs may pause and require user interaction before continuing.

Implement permission cards in the conversation.

## 10.1 Permission Card UI

Display:

- Tool name.
- Requested operation.
- Relevant resource or target.
- Short explanation.
- Permission scope.
- Runtime status.

Actions:

- Approve once.
- Reject.

Do not offer session-scoped, permanent, or other long-lived approval in v1.

## 10.2 Permission Processing

When a permission request arrives:

1. Identify the corresponding session.
2. Identify the pending request.
3. Display the permission card.
4. Pause normal interaction as required.
5. Wait for an explicit user decision.
6. Submit the decision using the official SDK response mechanism.
7. Update the UI.
8. Resume event processing.

Prevent duplicate responses.

Handle expired or invalid permission requests.

## 10.3 Auto-Approve Tools

Provide an Auto-approve tools option only if the selected SDK version exposes a verifiable run-scoped approval mechanism.

Behavior:

- Applies only to the current run.
- Skips individual permission prompts for supported tool operations.
- Must not silently change global security settings.
- Must not persist beyond the current run.
- Must be visibly enabled while active.

If run-scoped behavior cannot be verified, omit the option and require explicit approval for each request. Auto-approval is off by default.

Use the SDK's supported approval policy or permission handler.

---

# 11. Ask User Interaction

Copilot may request additional information through an `ask_user` interaction.

Render these questions as interactive cards.

Support:

- Question title.
- Question description.
- Available choices.
- The structured elicitation form and response shape supported by the SDK.
- Legacy `ask_user` handling only when required for compatibility.
- Accept, decline, or cancel only when offered by the SDK for that request.
- Validation.
- No silent dismissal of a pending request.

After submission:

1. Validate the answer.
2. Submit it through the SDK's supported interaction API.
3. Clear the pending interaction.
4. Resume the session.
5. Update the conversation.

Never assume all questions use the same response schema. Map the actual SDK payload.

---

# 12. Plan Mode

The documented Node SDK does not provide a public plan-response interaction API. Do not implement plan approval, feedback, continuation cards, or plan-file parsing as a substitute. Plan interactions are not a v1 release gate. Revisit this section only when a documented public API is verified.

---

# 13. Steering Active Sessions

Implement a steering experience for SDK-managed active runs.

This is distinct from starting a new conversation.

## 13.1 Composer Modes

The composer should support two modes:

**Send mode**
- Used when no SDK-managed run is currently active.
- Sends a new message through the supported session interaction API.

**Steer mode**
- Used while an SDK-managed run is active.
- Delivers additional guidance to the existing run.
- Does not create a new session.
- Does not start a second independent run.

Display the current mode clearly.

Example UI:

```text
[ Steer the current run...             ] [Steer]
```

## 13.2 Steering Behavior

When the user submits guidance:

1. Identify the active SDK-managed run.
2. Verify that steering is currently allowed.
3. Send guidance using the SDK's supported steering or message-injection capability.
4. Associate the guidance with the existing run.
5. Continue receiving events from that same run.

Do not simulate steering by creating another session.

The UI may confirm that the SDK accepted a steering request, but must not claim the agent acted on it unless later events establish that outcome.

## 13.3 Steering Restrictions

Steering must be paused while the session is waiting for:

- Permission approval.
- An `ask_user` response.
- A plan-mode response.

When one of these interactions is pending:

- Disable the steering composer.
- Display why steering is unavailable.
- Direct the user to complete the pending interaction first.

For plan interactions, apply this restriction only if a documented public plan-response API is later verified.

## 13.4 Important Runtime Limitation

Steering is supported only for runs started or resumed and managed by this extension's SDK bridge.

A session created by another Copilot client may be visible in the SDK catalog, but the extension cannot necessarily take over its running process.

This includes separately running:

- Copilot App sessions.
- Terminal-based Copilot CLI sessions.
- Other SDK client processes.

If a session is not attachable, keep it read-only or offer supported resume functionality.

Clearly communicate this distinction in the UI and documentation.

---

# 14. Working Timeline

Build a collapsible Working timeline inside the conversation view.

Its purpose is to communicate what Copilot is doing without exposing internal model reasoning.

## 14.1 Timeline Events

Use appropriate user-facing intent and tool lifecycle events.

Examples:

- Understanding the request.
- Inspecting project files.
- Searching the codebase.
- Reading a file.
- Updating a file.
- Running tests.
- Executing a command.
- Reviewing changes.
- Preparing the final response.

Only show events when supported by actual SDK event data.

## 14.2 Timeline UI

Display:

- Activity icon.
- Human-readable description.
- Running/completed/failed state.
- Optional duration.
- Collapsible details where appropriate.

Group consecutive related activities.

Show the current activity prominently.

Allow the user to collapse the timeline.

## 14.3 Privacy and Transparency

Do not expose:

- Hidden model reasoning.
- Raw internal chain-of-thought.
- Raw hidden tool output.
- Internal prompts.
- Internal SDK implementation details.

The timeline should contain only appropriate user-facing status and tool lifecycle information.

If tool output contains sensitive information, do not expose it by default.

---

# 15. Mobile and Responsive Layout

Although the extension primarily runs inside VS Code, design the webview to adapt to narrow panels and smaller screens.

When the available width is limited:

- Selecting a session opens a full-height chat view.
- Provide a clear Back button to return to the session list.
- Use touch-friendly controls.
- Avoid horizontal overflow.
- Ensure the composer remains visible when the virtual keyboard is open where the host supports it.
- Keep permission and question actions easy to reach.
- Use compact session cards.

Do not rely on hover interactions for essential functionality.

Desktop should remain the primary optimized layout.

---

# 16. State Management

Use a predictable state-management approach.

React Context, reducers, or a lightweight state library are acceptable.

Maintain separate state for:

- Projects.
- Sessions.
- Selected session.
- Conversation events.
- Pagination.
- Active SDK runs.
- Pending permissions.
- Pending questions.
- Working timeline.
- Composer mode.
- Loading states.
- Error states.
- User preferences.

Avoid storing large conversation histories redundantly in multiple components.

The extension host should remain the authoritative source for SDK session state.

The frontend should receive normalized state updates through a typed messaging contract.

Closing the dashboard or switching sessions does not cancel a managed run. On reload or reopen, rehydrate session state and pending interactions from the extension host without submitting any response twice. Require explicit user action to resume sessions after extension activation.

Persist only lightweight local preferences and favorite/archive metadata. Do not persist transcripts, synchronize local metadata, or store credentials.

---

# 17. Webview Messaging Architecture

Implement a strongly typed communication layer between the extension host and React.

Define explicit message types.

Examples:

Extension to webview:

```ts
type ExtensionMessage =
  | { type: "sessions:loaded"; sessions: CopilotSession[] }
  | { type: "session:selected"; sessionId: string }
  | { type: "conversation:loaded"; sessionId: string; messages: ChatMessage[] }
  | { type: "conversation:event"; sessionId: string; event: ChatEvent }
  | { type: "session:status"; sessionId: string; status: SessionStatus }
  | { type: "permission:requested"; permission: PermissionRequest }
  | { type: "question:requested"; question: UserQuestion }
  | { type: "timeline:updated"; sessionId: string; events: TimelineEvent[] }
  | { type: "error"; message: string };
```

Webview to extension:

```ts
type WebviewMessage =
  | { type: "sessions:refresh" }
  | { type: "session:open"; sessionId: string }
  | { type: "session:resume"; sessionId: string }
  | { type: "session:create"; projectPath?: string }
  | { type: "message:send"; sessionId: string; content: string }
  | { type: "run:steer"; sessionId: string; content: string }
  | { type: "run:cancel"; sessionId: string }
  | { type: "permission:respond"; requestId: string; decision: string }
  | { type: "question:respond"; requestId: string; answer: unknown }
  | { type: "project:open"; projectPath: string };
```

These are illustrative contracts. Adapt the types to the actual application models and SDK.

Validate every incoming webview message.

Never trust arbitrary webview payloads.

Use request IDs or correlation IDs for asynchronous operations.

Return success and error responses to the frontend.

---

# 18. VS Code Commands and Keybindings

Register commands in package.json and implement them.

Suggested commands:

| Command | Description |
|---|---|
| `copilotSessions.openDashboard` | Open session dashboard |
| `copilotSessions.refreshSessions` | Refresh sessions |
| `copilotSessions.createSession` | Create a new session |
| `copilotSessions.openSession` | Open selected session |
| `copilotSessions.resumeSession` | Resume selected session |
| `copilotSessions.cancelRun` | Cancel active run |
| `copilotSessions.openProject` | Open associated project |
| `copilotSessions.copySessionId` | Copy session UUID |
| `copilotSessions.toggleAutoApprove` | Toggle current-run auto-approval only if a run-scoped SDK mechanism is verified |
| `copilotSessions.showPendingApprovals` | Show pending approvals |

Use command contributions and context menus appropriately.

Suggested keybinding:

- Provide a shortcut to open the dashboard, but avoid conflicting with common VS Code shortcuts.
- Allow users to customize keybindings through standard VS Code mechanisms.

---

# 19. Extension Settings

Expose settings through `contributes.configuration`.

Suggested settings:

```json
{
  "copilotSessions.autoRefresh": true,
  "copilotSessions.refreshInterval": 30,
  "copilotSessions.groupByProject": true,
  "copilotSessions.showWorkingTimeline": true,
  "copilotSessions.initialConversationRounds": 4,
  "copilotSessions.conversationRoundsPerLoad": 4,
  "copilotSessions.confirmBeforeCancel": true,
  "copilotSessions.cliPath": "",
  "copilotSessions.showReadOnlySessions": true,
  "copilotSessions.logLevel": "info"
}
```

These settings are illustrative.

Validate all settings and provide sensible defaults.

Security-sensitive behavior must default to the safest option.

Do not provide a persistent auto-approval setting. Any verified run-scoped auto-approval control is off by default and applies only to the current run.

An empty `copilotSessions.cliPath` uses the CLI runtime supplied by the official SDK package. A non-empty value is an explicit override to an existing compatible user-installed CLI; it must never trigger an automatic download or installation.

---

# 20. Security Requirements

Treat security as a first-class requirement.

Implement:

- Strict Content Security Policy for the webview.
- Nonce-based script execution.
- Local-only webview resource loading.
- Safe message validation.
- Safe Markdown rendering.
- Safe external-link handling.
- No arbitrary command execution from the webview.
- No exposure of secrets to React.
- Use only the SDK/CLI's supported authentication flow; never request or persist a separate personal access token.
- No unnecessary filesystem access.
- No direct modification of the shared Copilot session store.
- No transcript persistence, product analytics, or telemetry.
- Redacted operational diagnostics only; never log message content, tool output, or credentials.
- Explicit permission handling.
- Safe process lifecycle management.
- Proper disposal of SDK clients and subscriptions.

Use VS Code APIs for opening files, folders, URLs, and terminals.

Do not assume that running the SDK inside the extension host automatically provides a security sandbox.

Do not describe the extension as sandboxed unless actual OS-level isolation is implemented.

---

# 21. Error Handling and Recovery

Handle the following cases:

- SDK-provided CLI runtime unavailable or an explicitly configured CLI override cannot be started.
- CLI version incompatible with the SDK.
- SDK initialization failure.
- Copilot authentication unavailable.
- Session store unavailable.
- Invalid session UUID.
- Session no longer exists.
- Session cannot be resumed.
- Session ownership cannot be established.
- Pending work cannot be continued or verified.
- Permission request expired.
- User question response rejected.
- SDK process crashes.
- Webview reloads.
- Extension deactivates.
- Network or service failures.
- Unexpected event payloads.

Display understandable messages to users.

Log diagnostic information without leaking sensitive content.

Provide a Retry action where appropriate.

Do not silently swallow errors.

On extension-host shutdown, gracefully stop the SDK client and preserve session data, but do not promise an in-flight run continues. After an uncertain crash, mark live status Unknown, do not replay a user message, and require explicit Resume. Do not automatically resume sessions at activation.

---

# 22. Performance Requirements

Optimize for repositories with many sessions and long conversations.

Requirements:

- Load conversation history only on explicit resume. The SDK currently provides the complete event list, so paging applies to UI rendering rather than retrieval.
- Initially render only the latest four rounds.
- Load four older rounds on demand.
- Use efficient React rendering.
- Avoid unnecessary webview refreshes.
- Debounce metadata-only search.
- Persist only lightweight local preferences and favorite/archive metadata; do not cache conversation content or sync it.
- Avoid polling when SDK events can provide updates.
- Clean up subscriptions when sessions are closed.
- Avoid retaining large event payloads unnecessarily.
- Prevent memory leaks during long-running sessions.

Use virtualization only if profiling shows it is necessary.

---

# 23. Accessibility

Follow VS Code accessibility conventions.

Implement:

- Keyboard navigation.
- Visible focus indicators.
- ARIA labels.
- Accessible status announcements.
- Screen-reader-friendly permission cards.
- Proper button labels.
- Sufficient color contrast.
- Reduced-motion support.

Never communicate session state through color alone.

---

# 24. Testing Strategy

Build a meaningful automated test suite.

## Unit tests

Test:

- Session normalization.
- Session grouping.
- Session filtering.
- Event grouping.
- Conversation round calculation.
- Pagination.
- Markdown sanitization.
- Permission state transitions.
- Question response validation.
- Composer mode selection.
- Steering restrictions.
- Webview message validation.

## Integration tests

Test:

- SDK initialization.
- Session discovery.
- Session resumption.
- Pending-work continuation only where verified by the selected public API.
- Event subscription.
- Permission response handling.
- Question response handling.
- Steering.
- Run cancellation.

Mock the SDK for deterministic tests.

Where possible, include integration tests against a real supported CLI/SDK environment, but do not require authentication for the default test suite.

## Extension tests

Test:

- Extension activation.
- Command registration.
- Activity Bar registration.
- TreeView rendering.
- Dashboard opening.
- Webview message handling.
- Configuration changes.
- Disposal and cleanup.

---

# 25. User Interface Design Expectations

Build an attractive developer-oriented experience.

The visual design should feel like a natural extension of VS Code.

Suggested layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Copilot Sessions                         Refresh   Settings  │
├──────────────────┬───────────────────────────────────────────┤
│ Search sessions  │ Project: Contoso Portal                   │
│                  │ Session: Implement authentication         │
│ ALL SESSIONS     │ Status: Running                            │
│ Active           ├───────────────────────────────────────────┤
│ Recent           │                                           │
│ Waiting          │ User                                      │
│ Favorites        │ Implement authentication for this API.    │
│                  │                                           │
│ PROJECTS         │ Copilot                                   │
│ Contoso Portal   │ I'll inspect the existing authentication  │
│ Fabrikam App     │ implementation first.                     │
│ Demo Workspace   │                                           │
│                  │ ┌─ Working ─────────────────────────────┐  │
│ SESSIONS         │ │ ✓ Inspecting project files           │  │
│ Authentication   │ │ ✓ Reviewing existing middleware      │  │
│ API refactoring  │ │ ● Implementing authentication        │  │
│ Bug investigation│ └──────────────────────────────────────┘  │
│                  │                                           │
│                  │ Permission required                       │
│                  │ Execute npm test?                         │
│                  │ [Approve once] [Reject]                   │
│                  │                                           │
│                  ├───────────────────────────────────────────┤
│                  │ Steer the current run...          [Steer] │
└──────────────────┴───────────────────────────────────────────┘
```

This is a conceptual layout, not a requirement to reproduce it pixel-for-pixel.

Prioritize clarity, compactness, usability, and native VS Code integration.

---

# 26. Product Behavior and Acceptance Criteria

The implementation is complete only when the following scenarios work.

### Scenario A: Discover sessions

1. Activate the extension.
2. Open Copilot Sessions.
3. Discover the sessions exposed by the verified official SDK listing API.
4. Display projects and sessions.
5. Search metadata and filter the results.
6. Select a session.
7. View its conversation and metadata.

### Scenario B: Resume an existing session

1. Select a resumable session.
2. Click Resume.
3. Resume using its existing UUID.
4. Restore pending work only when verifiable; otherwise explain the limitation.
5. Subscribe to events.
6. Continue interacting with the session.

### Scenario C: Inspect a session without verified control

1. Select a session whose origin or control capability is not established.
2. Display its history when available.
3. Label unknown origin/status honestly.
4. Do not present it as controllable.
5. Offer Resume only when the documented SDK supports it.

### Scenario D: Stream an assistant response

1. Send a message.
2. Display streaming output.
3. Group consecutive assistant events.
4. Update the Working timeline.
5. Display the completed response.
6. Preserve the user's reading position.

### Scenario E: Approve a tool

1. Start an SDK-managed run.
2. Trigger a permission request.
3. Display the permission card.
4. Approve once.
5. Continue the same run.
6. Display subsequent events.

### Scenario F: Ask user interaction

1. Trigger an `ask_user` interaction.
2. Render the question and choices.
3. Render the documented structured elicitation response options.
4. Submit the response.
5. Continue the same session.

### Scenario G: Unsupported plan interaction

1. Encounter a session/runtime without a documented plan-response API.
2. Do not render plan approval or feedback controls.
3. Explain that plan interaction is unsupported by the verified SDK surface.
4. Continue offering only independently supported inspection or session actions.

### Scenario H: Steer an active run

1. Start or resume a run through the extension.
2. Wait until the run is active.
3. Change the composer to Steer mode.
4. Submit additional guidance.
5. Deliver it to the existing run.
6. Verify that no new session is created.

### Scenario I: Pending interaction disables steering

1. Start a managed run.
2. Trigger a permission or question request.
3. Verify that steering is disabled.
4. Resolve the pending interaction.
5. Verify that steering becomes available again when appropriate.

### Scenario J: Load older conversation history

1. Open a session with a long conversation.
2. Display the latest four rounds.
3. Click Load more.
4. Display four earlier rounds.
5. Verify that the reading position does not jump.

### Scenario K: Responsive UI

1. Open the extension in a narrow VS Code panel.
2. Select a session.
3. Verify that the chat takes over the available view.
4. Navigate back to the session list.
5. Verify that the composer and action controls remain usable.

---

# 27. Implementation Approach

Work incrementally, but complete the entire product.

Follow this sequence:

**Phase 1 — Repository and SDK analysis**
- Inspect the existing repository.
- Inspect the official Copilot SDK.
- Verify CLI requirements.
- Document supported APIs.
- Identify technical limitations.

**Phase 2 — Extension foundation**
- Create extension manifest.
- Configure TypeScript and bundling.
- Register Activity Bar.
- Register commands.
- Implement logging and configuration.

**Phase 3 — SDK integration**
- Implement SDK service.
- Implement session discovery.
- Normalize session data.
- Implement project grouping.
- Implement capability detection.

**Phase 4 — Dashboard**
- Implement React webview.
- Implement session list.
- Implement search and filters.
- Implement project navigation.
- Implement VS Code theme integration.

**Phase 5 — Conversation experience**
- Implement session history.
- Implement assistant event grouping.
- Implement Markdown rendering.
- Implement pagination.
- Implement streaming.

**Phase 6 — Runtime interactions**
- Implement session resumption.
- Implement pending-work continuation only when verified by the selected public SDK API.
- Implement permissions.
- Implement ask_user.
- Implement steering.
- Implement cancellation.

**Phase 7 — Working timeline**
- Normalize user-facing intent and tool lifecycle events.
- Implement timeline grouping.
- Implement status updates.
- Implement collapsible UI.

**Phase 8 — Hardening**
- Security.
- Error handling.
- Performance.
- Accessibility.
- Tests.
- Documentation.
- Packaging.

---

# 28. Development Rules

Follow these rules throughout implementation:

1. Do not stop after creating a project scaffold.
2. Do not deliver only a prototype or static UI.
3. Do not use mock data in the production runtime.
4. Mock SDK functionality only in tests.
5. Do not invent unsupported SDK APIs.
6. Do not bypass Copilot permission mechanisms.
7. Do not assume all sessions can be resumed.
8. Do not assume all sessions can be steered.
9. Do not create a new session when resuming an existing one.
10. Do not expose hidden model reasoning.
11. Do not expose raw tool output by default.
12. Do not access or modify private session-store files directly.
13. Do not put SDK integration inside React components.
14. Do not place all business logic inside the extension entry point.
15. Use strict TypeScript.
16. Prefer small, focused services and components.
17. Provide meaningful error messages.
18. Add tests for critical functionality.
19. Keep the extension compatible with supported VS Code versions.
20. Document limitations honestly.

When an implementation decision depends on an unsupported capability, omit or disable that operation with a clear explanation rather than implementing a fake behavior. Session discovery and resumption through documented SDK APIs are release gates; secondary interactions are not.

---

# 29. Final Deliverables

Produce:

1. Complete VS Code extension source code.
2. Complete React webview source code.
3. SDK integration layer.
4. Session discovery and management implementation.
5. Streaming conversation implementation.
6. Permission and interaction management.
7. Steering implementation where supported.
8. Working timeline.
9. VS Code command and Activity Bar integration.
10. Settings and configuration.
11. Unit and integration tests.
12. Extension packaging configuration.
13. README with installation and usage instructions.
14. Architecture documentation.
15. SDK capability and limitation documentation.
16. Troubleshooting guide.
17. Development and debugging instructions.
18. A packaged `.vsix` extension if the environment supports building it.

The README must explain:

- Prerequisites.
- Supported GitHub Copilot CLI and SDK versions.
- Installation.
- Authentication requirements.
- How session discovery works.
- How to resume a session.
- How steering works.
- Permission behavior.
- Why some sessions are read-only.
- Why an independently running Copilot App or CLI process cannot necessarily be controlled.
- That plan-response UI and pending-work recovery are unavailable unless verified by a documented public API.
- Known limitations.

---

# 30. Start Building

Start by inspecting the current repository and the installed `@github/copilot-sdk` package.

Before writing the implementation, produce a concise technical assessment containing:

- Existing project structure.
- SDK and CLI versions.
- Verified SDK APIs.
- Session discovery capabilities.
- Session resumption capabilities.
- Pending-work continuation support.
- Permission and question handling support.
- Plan-mode API availability and limitations.
- Steering support.
- Known limitations.

Then create an implementation plan and execute it.

Do not stop at the plan.

Implement the extension in working increments. After each phase:

1. Build the project.
2. Run relevant tests.
3. Fix compilation and test failures.
4. Update the documentation.
5. Continue to the next phase.

If the SDK does not support a requested capability, explain the limitation, implement the closest safe supported behavior, and keep the architecture ready for future SDK support.

**The goal is a complete, maintainable, secure, developer-focused VS Code extension that makes GitHub Copilot sessions discoverable, understandable, and manageable from one centralized workspace.**






## Additional recommendations before you run the prompt
There are a few architectural decisions I'd strongly recommend keeping, because they will make the difference between a useful extension and a fragile prototype.
1. Use the extension host as the control plane
VS Code Extension Host

Session orchestration · SDK · CLI · permissions · event processing

Typed message bridge
React Webview

Dashboard · conversation · timeline · approvals · composer


GitHub Copilot SDK

Documented session discovery · managed runs · streaming events

GitHub Copilot CLI / supported runtime


Keep all SDK and process interactions in the extension host. The React webview should never communicate directly with the SDK or CLI. This gives you a single place to manage permissions, session ownership, event subscriptions, and lifecycle cleanup.
2. Make session ownership a first-class concept
I would make this one of the extension's defining features.
Session state	Discover	Read history	Resume	Steer
Managed by extension	Yes	Yes	Yes	Yes, if supported
Resumable through SDK	If listed	If available	Yes	After successful resume
Other/unknown client	If listed	If available	If supported	No direct takeover

This avoids one of the most misleading behaviors a session manager could have: making users believe that seeing a session means they can control its original running process.
3. Build the session engine before polishing the UI
My recommended implementation priority:
1. Session discovery and normalization.
2. Session capability detection.
3. Resume and capability detection for pending work; never claim unsupported continuation.
4. Event streaming and state management.
5. Permission, question, and any other interactions with verified public API support.
6. Steering only for runs managed by this extension.
7. React dashboard and conversation UI.
8. Timeline, filtering, and visual polish.
The UI is important, but the session lifecycle is the actual product.
4. One additional feature I'd include in the roadmap
Session handoff and context export.

Allow users to export a session's conversation and relevant metadata into a Markdown file, or generate a concise handoff summary for another Copilot session.

This would be especially valuable when switching projects, changing agents, or continuing work in a different development environment. Keep it as a later feature rather than making it a dependency for the first release.

My recommendation: Build the first version as a VS Code Activity Bar extension with a full React dashboard, while keeping the session engine independent of the UI behind the extension-host control plane.

---

# 31. Design Interview Record

This record captures every question and accepted answer from the design interview on 2026-10-26. Answers are recorded in order. The initial CLI-installation answer to Q13 was revised by Q28 after checking the official Node SDK documentation; the current decision is the Q28 answer. Canonical domain language is in [GLOSSARY.md](./GLOSSARY.md), and the extension-host control-plane decision is in [ADR 0001](./docs/adr/0001-extension-host-control-plane.md).

1. **Q1 — Product job:** Should v1 focus on discovery, management of sessions the extension controls, or both?<br>
   **Answer:** Both. Discovery is the front door; management is for sessions the extension can actually control. Other sessions are inspectable or resumable only when supported, never presented as takeover-capable.

2. **Q2 — Session and run:** Should a session be the persistent conversation with a stable ID, a run be one period of agent execution, and client ownership be separate?<br>
   **Answer:** Yes. Session, run, and client ownership are distinct concepts.

3. **Q3 — Audience:** Should v1 target individual developers rather than team sharing, collaboration, or administration?<br>
   **Answer:** Yes. Individual developers, local preferences, and no shared-team workflow.

4. **Q4 — Control boundary:** Should the extension avoid claiming control when a session is visible but its original process is not attachable?<br>
   **Answer:** Yes. Offer only verified supported capabilities and label them clearly.

5. **Q5 — Product name:** Should the user-facing product be Copilot Orbit, with “session manager” as its description?<br>
   **Answer:** Yes — Copilot Orbit.

6. **Q6 — Primary UI:** Should v1 include both a full dashboard and Activity Bar TreeViews?<br>
   **Answer:** Yes — dashboard plus Activity Bar TreeViews for projects, sessions, and pending approvals.

7. **Q7 — Session-list actions:** Should favorites/archive be local metadata and v1 avoid renaming or deleting underlying sessions?<br>
   **Answer:** Yes — local-only favorites/archive; no rename/delete in v1.

8. **Q8 — Transcript search:** Should v1 search session metadata rather than index conversation text across sessions?<br>
   **Answer:** Yes — metadata-only search in v1.

9. **Q9 — Local data retention:** Should persistence be limited to preferences/UI metadata, with no conversation cache or sync?<br>
   **Answer:** Yes — preferences and UI metadata only; local, no sync.

10. **Q10 — Permission defaults:** Should permissions require explicit approval by default, with optional current-run auto-approval only if supported?<br>
    **Answer:** Yes — explicit approval; optional current-run auto-approval only.

11. **Q11 — Decision documentation:** Should the full Q&A go in PRD.md, domain terms in GLOSSARY.md, and ADRs be limited to justified decisions?<br>
    **Answer:** Yes — Q&A in PRD.md, terms in GLOSSARY.md, justified ADRs only.

12. **Q12 — Official API release gate:** If official APIs cannot support core discovery/resumption, should v1 avoid private stores, undocumented CLI commands, and invented APIs, and be blocked from release?<br>
    **Answer:** Yes — supported core discovery/resumption is a release gate.

13. **Q13 — Runtime installation (initial decision):** Should the extension bundle the SDK but require a compatible user-installed CLI and never auto-install/update it?<br>
    **Answer:** Yes — require a user-installed CLI; no automatic installation. **Superseded by Q28** after researching the SDK's documented runtime packaging.

14. **Q14 — Authentication boundary:** Should the extension rely on supported CLI/SDK authentication and never request/store a separate personal access token?<br>
    **Answer:** Yes — rely on CLI/SDK authentication; do not store credentials.

15. **Q15 — Discovery scope:** Should the catalog include all sessions exposed by the official API across projects and label unknown source/project metadata rather than guessing?<br>
    **Answer:** Yes — all official API-exposed sessions across projects.

16. **Q16 — Resume semantics:** Should Resume continue the same conversation under the existing ID without claiming takeover of the original client process?<br>
    **Answer:** Yes — same conversation and ID; no takeover claim.

17. **Q17 — Unsupported advanced interactions:** If a secondary capability is unsupported, should its action be omitted/disabled rather than faked, without blocking release when core discovery/resumption works?<br>
    **Answer:** Yes — expose only verified secondary capabilities; the core gate remains discovery/resumption.

18. **Q18 — Status claims:** Should live “running/controllable” status require a verified managed runtime, with external last-known status distinguished?<br>
    **Answer:** Yes — distinguish live managed status from last-known metadata.

19. **Q19 — Archive meaning:** Should Archive reversibly hide sessions from ordinary views without deleting/changing the Copilot session?<br>
    **Answer:** Yes — reversible, local-only organization; never delete the session.

20. **Q20 — Concurrent managed runs:** Should the extension allow multiple runs when safely supported and otherwise enforce/explain the documented limit?<br>
    **Answer:** Yes — allow supported concurrency and enforce documented limits.

21. **Q21 — New-session workspace:** Should a single active workspace be the default, with an explicit folder prompt when there are zero or multiple folders?<br>
    **Answer:** Yes — use an unambiguous active workspace or prompt.

22. **Q22 — Telemetry and diagnostics:** Should v1 send no product analytics and use only redacted operational diagnostics?<br>
    **Answer:** Yes — no analytics; redacted diagnostics only.

23. **Q23 — Default catalog view:** Should the dashboard open to All Sessions, sorted by latest activity, preserving selection and filters on refresh?<br>
    **Answer:** Yes — All Sessions, latest activity first; preserve on refresh.

24. **Q24 — Archived session becomes active:** Should active/pending archived sessions remain visible in those views with an archived marker?<br>
    **Answer:** Yes — surface in Active/Pending with archived marker.

25. **Q25 — Opening an archived session:** Should opening/inspecting leave it archived until explicit Unarchive?<br>
    **Answer:** Yes — do not auto-unarchive.

26. **Q26 — Session missing from catalog:** Should local ID/favorite/archive references remain as unavailable entries, without transcript content, until the user removes them?<br>
    **Answer:** Yes — retain minimal local reference; no transcript cache.

27. **Q27 — Resume when already managed:** Should Resume focus the existing runtime instead of creating a duplicate?<br>
    **Answer:** Yes — focus the existing managed runtime.

28. **Q28 — CLI runtime packaging:** Given the SDK-provided runtime and explicit local CLI override, should v1 use the SDK runtime by default?<br>
    **Answer:** Use the SDK-provided runtime; allow an explicit local CLI override. This supersedes Q13.

29. **Q29 — Plan interactions:** Should v1 omit plan-response UI unless a documented public SDK API is verified, rather than treating `plan.md` as an interaction API?<br>
    **Answer:** Yes — no plan-response UI without a documented supported API.

30. **Q30 — Pending-work recovery:** If pending execution cannot be verified, should v1 restore history and state that pending work may not continue rather than synthesize recovery?<br>
    **Answer:** Yes — no fabricated pending-work recovery.

31. **Q31 — Question interaction format:** Should structured elicitation be primary, with legacy `ask_user` only for compatibility?<br>
    **Answer:** Yes — structured elicitation primary; legacy only for compatibility.

32. **Q32 — Sessions without a title:** Should the UI use the SDK summary or a neutral short session ID instead of inventing a title?<br>
    **Answer:** Yes — summary if present; otherwise neutral short session ID.

33. **Q33 — Approval scope:** Should the UI offer Approve once/Reject only, with current-run auto-approval conditional on a verified run-scoped API?<br>
    **Answer:** Yes — one-request approval only; run-scoped auto-approval only if verified.

34. **Q34 — Transcript recovery on resume:** Should the extension use the official SDK recovery behavior and disclose a reported repair, without writing to the store itself?<br>
    **Answer:** Yes — use official recovery and disclose reported repair.

35. **Q35 — Catalog freshness:** Should refresh use lifecycle events where available plus a configurable 30-second fallback poll enabled by default?<br>
    **Answer:** Yes — lifecycle events plus configurable 30-second fallback polling.

36. **Q36 — Cancellation semantics:** Should Cancel Run abort only the active run, preserve session/history, confirm by default, and omit unsupported completion/deletion?<br>
    **Answer:** Yes — abort active run only, preserve session, confirm by default.

37. **Q37 — Steering feedback:** Should the UI report SDK acceptance without claiming the agent acted on the instruction?<br>
    **Answer:** Yes — distinguish accepted from acted upon.

38. **Q38 — Question decline/cancel:** Should the UI expose only explicit SDK-supported response actions and never silently dismiss a pending question?<br>
    **Answer:** Yes — expose only explicit SDK-supported actions.

39. **Q39 — Session handoff/export:** Should Markdown export and handoff summaries stay out of v1?<br>
    **Answer:** Yes — defer to a later roadmap.

40. **Q40 — Extension-host control plane:** Should SDK/runtime/state control stay in the host, with the webview presentation-only over a validated message bridge?<br>
    **Answer:** Yes — extension host owns control; webview is presentation only.

41. **Q41 — Catalog categories:** Should v1 include All, Recent, Active, Pending Approvals, Completed, Failed, Favorites, and Archived, showing statuses only when evidenced?<br>
    **Answer:** Yes — all listed categories, no inferred statuses.

42. **Q42 — Project-path display:** Should ordinary rows show a folder name and reserve full paths for details or explicit actions?<br>
    **Answer:** Yes — hide full paths from ordinary rows.

43. **Q43 — Origin labels:** Should source labels use only documented distinctions and otherwise display Unknown source?<br>
    **Answer:** Yes — report only evidenced source, Unknown otherwise.

44. **Q44 — Closing the dashboard:** Should a managed run continue when the dashboard closes or switches sessions, with only explicit Cancel Run aborting it?<br>
    **Answer:** Yes — closing/switching views does not cancel a run.

45. **Q45 — Webview reload/reopen:** Should the host rehydrate state and pending interactions without submitting a response twice?<br>
    **Answer:** Yes — rehydrate from host state; prevent duplicate responses.

46. **Q46 — Multiple dashboards:** Should v1 reuse one canonical dashboard panel?<br>
    **Answer:** Yes — one canonical reused dashboard.

47. **Q47 — Pending-work notifications:** Should pending work appear in the TreeView/count without interruptive pop-ups by default?<br>
    **Answer:** Yes — visible count/TreeView, no interruptive popup by default.

48. **Q48 — Multiple pending interactions:** Should each request remain separately listed, age-ordered, and independently actionable?<br>
    **Answer:** Yes — list each independently and preserve others.

49. **Q49 — Clean extension shutdown:** Should the extension stop its SDK client and preserve session data, without promising active work survives shutdown?<br>
    **Answer:** Yes — stop client, preserve sessions, warn active work may not continue.

50. **Q50 — Recovery after crash/restart:** If completion is uncertain, should status be Unknown, with no automatic replay and explicit inspection/resume?<br>
    **Answer:** Yes — Unknown after uncertain crash; never replay automatically.

51. **Q51 — Auto-resume at activation:** Should users explicitly select Resume rather than have the extension attach automatically after activation?<br>
    **Answer:** Yes — require explicit Resume.

52. **Q52 — Product promise:** Should the README replace “Every Copilot session. Full control” with a capability-bounded promise?<br>
    **Answer:** Yes — “Every discoverable Copilot session. Clear control where supported.”

53. **Q53 — Reconciling the PRD:** Should normative PRD sections be updated while preserving this complete Q&A record separately?<br>
    **Answer:** Yes — reconcile the normative spec and retain the complete Q&A log.

54. **Q54 — Follow-through scope:** Should this task stop at documentation changes after confirmation, rather than begin implementing the extension?<br>
    **Answer:** Documentation only — PRD, glossary, justified ADR, README promise.
55. **Q55 — Per-session settings:** Should per-session settings remain deferred until concrete session-scoped controls are defined?<br>
    **Answer:** Yes — defer per-session settings from v1; do not invent controls.
56. **Q56 — SDK history paging:** Since the SDK returns the complete event history, should Orbit retain UI pagination and document that retrieval itself is not lazy-loaded?<br>
    **Answer:** Yes — retain UI pagination and document the SDK limitation; use SDK-level paging if it becomes available.
57. **Q57 — Extension-host test runner:** Should the project add the VS Code Extension Test Runner and a smoke test in addition to the approved facade and webview protocol seams?<br>
    **Answer:** Yes — add the test runner and verify extension activation and command registration without starting the Copilot runtime.