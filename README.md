# Copilot Orbit

**Every discoverable Copilot session. Clear control where supported.**

Copilot Orbit is a VS Code extension for discovering and managing Copilot CLI sessions. Browse all sessions from a unified dashboard, inspect conversation history, create new sessions, and respond to tool permission requests—all without leaving VS Code.

> **Note:** Copilot Orbit manages only sessions that the Copilot SDK runtime can control.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Runtime & Compatibility](#runtime--compatibility)
- [Architecture](#architecture)
- [Development](#development)
- [License](#license)

## Features

### Session Discovery & Management
- **Browse all sessions** with filtering: Recent, Active, Pending, Completed, Failed, Favorites, Archived
- **Group sessions by project** to organize work across multiple projects
- **Resume sessions** by their original ID and inspect full conversation history
- **Create new sessions** directly from the extension
- **Copy session IDs** for reference or sharing

### Session Control
- **Send messages** to active sessions
- **Steer active runs** (when supported by the runtime)
- **Cancel runs** with optional confirmation
- **Respond to approvals** and tool permission requests in real-time

### User Experience
- **Live status** without guessing—status remains Unknown until explicitly established
- **Sanitized Markdown** with syntax-highlighted code blocks
- **Paginated conversation history**—loads latest 4 rounds initially, reveal earlier rounds on demand
- **Pending Approvals badge**—age-ordered approval requests with a count badge
- **Search metadata** and filter by session source (Local, Remote, Unknown)
- **Multiple views**—Dashboard, Activity Bar tree views (All Sessions, Active, Projects, Approvals)

### Privacy & Security
- **Local favorites & archive markers**—reversible, stored locally only
- **No transcript persistence**—conversation data remains in memory
- **No credential storage**—credentials are never persisted by the extension

## Requirements

- **VS Code:** 1.95.0 or later
- **Node.js:** 20.19.0 or later (for development)
- **Copilot CLI:** Compatible version (bundled with SDK or provide custom path)

## Installation

Copilot Orbit is available on the [VS Code Marketplace](https://marketplace.visualstudio.com). Search for "Copilot Orbit" and click Install.

To use a custom Copilot CLI instead of the SDK-bundled runtime:
1. Open VS Code Settings
2. Search for `Copilot Orbit: CLI Path`
3. Enter the full path to your Copilot CLI executable
4. Reload VS Code

## Quick Start

1. **Open the Dashboard**
   - Run command: `Copilot Orbit: Open Dashboard`
   - Or click the Copilot Orbit icon in the Activity Bar

2. **Browse Sessions**
   - View all sessions or filter by status (Recent, Active, Failed, etc.)
   - Sessions are sorted by recent activity and grouped by project

3. **Open a Session**
   - Click a session to open it and view conversation history
   - The dashboard loads the latest 4 conversation rounds
   - Scroll up to load earlier rounds as needed

4. **Respond to Approvals**
   - Check the "Pending Approvals" Activity Bar view for pending requests
   - Click to view and approve tool permission requests or answer questions

5. **Create a New Session**
   - Run command: `Copilot Orbit: Create Session`
   - Configure the session and start a new Copilot chat

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) or through the Activity Bar views:

| Command | Description | Keyboard |
|---------|-------------|----------|
| **Copilot Orbit: Open Dashboard** | Open the main dashboard in a new panel | - |
| **Copilot Orbit: Refresh Sessions** | Manually refresh the session catalog | - |
| **Copilot Orbit: Create Session** | Create a new Copilot session | - |
| **Copilot Orbit: Resume Session** | Resume a session by ID | - |
| **Copilot Orbit: Copy Session ID** | Copy a session's ID to clipboard | - |
| **Copilot Orbit: Open Project** | Open a session's project folder | - |
| **Copilot Orbit: Cancel Run** | Abort the current active run | - |
| **Copilot Orbit: Show Pending Approvals** | Focus on the Pending Approvals view | - |

**Notes:**
- **Cancel Run** asks for confirmation by default (disable in settings)
- Closing the dashboard does not cancel an active run
- Shutting down VS Code stops the SDK client, which may interrupt active work

## Runtime & Compatibility

### SDK & Runtime

Copilot Orbit uses `@github/copilot-sdk` and runs the bundled Copilot runtime by default. It does not silently download or update additional CLI versions.

**To use a custom CLI:**
- Set **Copilot Orbit: CLI Path** in extension settings
- Provide the full path to a compatible Copilot CLI executable

### Session Behavior

- The SDK catalog distinguishes sessions by source (local or remote)
- **Resume behavior**: Explicitly resuming a session opens a new connection; it does not take over another Copilot App, terminal, or SDK process
- **Pending work**: Not replayed on resume—only new messages are processed from the resume point
- **No plan approval**: Plan approval, session deletion, persistent permission grants, telemetry, and cross-device synchronization are not yet supported

### Conversation History

- The SDK loads full conversation history via `getEvents()` when a session is resumed
- Orbit renders only the **latest 4 conversation rounds** initially for performance
- Earlier rounds load on demand when you scroll up
- **All data stays in memory**—conversation history is never written to extension storage
- Reloading VS Code clears conversation memory; resume the session to reload

### Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `copilotSessions.autoRefresh` | Boolean | `true` | Refresh the session catalog automatically |
| `copilotSessions.refreshInterval` | Number | `30` | Fallback refresh interval (10–300 seconds) |
| `copilotSessions.groupByProject` | Boolean | `true` | Group sessions by known project context |
| `copilotSessions.showWorkingTimeline` | Boolean | `true` | Show tool activity in the conversation |
| `copilotSessions.confirmBeforeCancel` | Boolean | `true` | Confirm before aborting a run |
| `copilotSessions.logLevel` | String | `info` | Diagnostic log level (error, warn, info, debug) |
| `copilotSessions.cliPath` | String | (empty) | Path to custom Copilot CLI (empty uses SDK runtime) |

## Architecture

### High-Level Design

Copilot Orbit connects VS Code to the Copilot runtime through a layered architecture:

```
┌─────────────────────────────────────┐
│   React Dashboard (Webview UI)      │  Browse sessions, view conversations,
│   + Activity Bar Tree Views         │  send messages, manage approvals
└──────────────┬──────────────────────┘
               │ WebviewMessage Protocol
               ↓
┌──────────────────────────────────────┐
│  Extension Host                      │
│  ├─ DashboardProvider               │  Manages webview lifecycle and messaging
│  ├─ SessionTreeProvider             │  Populates Activity Bar tree views
│  └─ Extension.ts                    │  Coordinates services
└──────────────┬──────────────────────┘
               │ Session Events
               ↓
┌──────────────────────────────────────┐
│  SessionManagementFacade            │  Maintains session state, processes SDK
│  ├─ Session Registry                │  events, broadcasts updates
│  ├─ Conversation History            │
│  └─ Pending Interactions            │
└──────────────┬──────────────────────┘
               │ SDK API
               ↓
┌──────────────────────────────────────┐
│  @github/copilot-sdk                │  Session lifecycle management,
│  (CopilotClient)                    │  event streaming
└──────────────┬──────────────────────┘
               │
               ↓
┌──────────────────────────────────────┐
│  Copilot Runtime                     │  Bundled or custom CLI path
│  (Local Sessions)                    │
└──────────────────────────────────────┘
```

### Core Components

**Extension Host** (`src/extension.ts`)
- Activates the extension and initializes the SDK client
- Creates and wires together all services
- Manages lifecycle events from the SDK (session created/updated/deleted)
- Subscribes to facade updates and broadcasts to all UI components

**SessionManagementFacade** (`src/services/sessionManagementFacade.ts`)
- Central abstraction layer wrapping the Copilot SDK
- Maintains in-memory registry of managed sessions with their state
- Handles session lifecycle: resume, create, send messages, abort, disconnect
- Processes SDK events and converts them to internal messages
- Manages pending interactions (permission requests, questions)
- Maintains paginated conversation history and working timeline
- Publishes updates via pub/sub to extension listeners

**DashboardProvider** (`src/services/dashboardProvider.ts`)
- Manages the React dashboard webview and webview view
- Handles bidirectional messaging between UI and facade
- Broadcasts facade updates to all active webviews
- Manages local metadata (favorites, archived sessions)
- Handles user commands (open session, copy ID, etc.)

**SessionTreeProvider** (`src/services/sessionTreeProvider.ts`)
- Populates four Activity Bar tree views: All Sessions, Active, Projects, Pending Approvals
- Filters sessions by status, source, and other criteria
- Handles tree item clicks and context menu commands

**React Dashboard** (`webview-ui/src/main.tsx`)
- Interactive UI built with React for session browsing and management
- Features: session list with filters, conversation viewer, message composer
- Displays pending approvals and questions
- Renders markdown with syntax highlighting
- Lazy-loads conversation history (4 rounds at a time)

**Domain Models** (`src/domain/`)
- `session.ts`: Session type definitions (status, control capability, metadata)
- `messages.ts`: Protocol definitions for extension ↔ webview communication

### Data Flow: Opening a Session

1. User clicks session in webview → posts `WebviewMessage` to extension
2. `DashboardProvider` receives message → calls `facade.resumeSession()`
3. `SessionManagementFacade` → calls `CopilotClient.resumeSession()` via SDK
4. SDK → connects to runtime, establishes session
5. Runtime → sends session events (status changes, events)
6. `SessionManagementFacade` → listens to events, updates internal state
7. Facade → broadcasts `ExtensionMessage` to all listeners
8. `DashboardProvider` + `SessionTreeProvider` → receive updates
9. Webviews + tree views → re-render with new session state

### Key Architectural Decisions

- **Facade Pattern**: Abstracts SDK complexity and provides a cleaner API for the extension
- **Pub/Sub Messaging**: Decouples services; facade publishes updates that multiple views can subscribe to
- **Webview Protocol**: Typed, validated message protocol between extension and React UI
- **In-Memory State**: Sessions and conversations held in memory, never persisted
- **Lazy Conversation Loading**: Loads full history on resume but renders only latest 4 rounds initially
- **Local Metadata Only**: Favorites and archive status stored locally; credentials never persisted

## Development

### Prerequisites

- **Node.js:** 20.19.0 or later
- **VS Code:** 1.95.0 or later (for extension testing)
- **Git:** For cloning and contributing

### Setup

```sh
# Clone the repository
git clone https://github.com/mohammadamer/copilot-orbit.git
cd copilot-orbit

# Install dependencies
npm install
```

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Build the extension (`dist/extension.js` + webview bundle) |
| `npm run watch` | Watch mode—rebuild on file changes |
| `npm run typecheck` | Run TypeScript type checking |
| `npm lint` | Lint code with ESLint |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without modifying |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:extension` | Run extension host smoke test |
| `npm run package` | Package the extension as `.vsix` |

### Project Structure

```
copilot-orbit/
├── src/                          # Extension host (TypeScript)
│   ├── extension.ts              # Entry point, service initialization
│   ├── domain/                   # Domain models
│   │   ├── session.ts            # Session types & interfaces
│   │   └── messages.ts           # Message protocol types
│   └── services/                 # Core services
│       ├── sessionManagementFacade.ts  # SDK wrapper & state management
│       ├── dashboardProvider.ts       # Webview lifecycle & messaging
│       └── sessionTreeProvider.ts     # Activity Bar tree views
├── webview-ui/                   # React dashboard (TypeScript + React)
│   └── src/
│       └── main.tsx              # React app, conversation viewer, session browser
├── tests/                        # Test files
│   ├── unit/                     # Unit tests for services & domain
│   └── extensionHost/            # VS Code extension host tests
├── resources/                    # Icons and assets
├── tsconfig.json                 # TypeScript config
├── esbuild.mjs                   # Build configuration
└── vitest.config.ts              # Test configuration
```

### Development Workflow

**1. Start development mode:**
```sh
npm run watch
```
This rebuilds the extension and webview on file changes.

**2. Run the extension:**
- Press `F5` in VS Code (when `.vscode/launch.json` is configured)
- Or open the Command Palette and select "Debug: Start Debugging"
- This launches VS Code in debug mode with the extension loaded

**3. Test changes:**
```sh
npm test              # Unit tests
npm run test:watch   # Watch mode for TDD
```

**4. Type checking:**
```sh
npm run typecheck
```

**5. Linting & formatting:**
```sh
npm run lint           # Check for issues
npm run format         # Auto-fix formatting
```

### Testing Strategy

**Unit Tests** (Vitest)
- Test the facade and webview protocol at SDK and message boundaries
- Located in `tests/unit/`
- Run with `npm test` or `npm run test:watch`

**Extension Host Smoke Test**
- Launches VS Code with an intentionally unavailable CLI path
- Verifies activation, command registration, and error handling
- Ensures the extension loads gracefully without a runtime
- Run with `npm run test:extension`

**Manual Testing**
- Use `F5` to run the extension in debug mode
- Test session discovery, resume, create, and approval flows
- Verify UI rendering and message handling

### Code Quality

- **TypeScript:** Strict mode enabled; type-check before committing
- **ESLint:** Enforces code style and catches common errors
- **Prettier:** Auto-formats code for consistency
- **Vitest:** Fast unit testing framework
- All commits should pass: `npm run lint && npm run typecheck && npm test`

### Building & Packaging

**Build for development:**
```sh
npm run build
```

**Build for release:**
```sh
npm run package
```
Creates `copilot-orbit-X.X.X.vsix` for distribution on the Marketplace.

### Debugging

**In VS Code (F5 debugging):**
1. Set breakpoints in `src/extension.ts` or `webview-ui/src/main.tsx`
2. Press `F5` to start debugging
3. The extension will pause at breakpoints
4. Use the Debug Console to inspect state

**Console logging:**
- Extension: Use `console.log()` in `src/`—output appears in "Copilot Orbit" debug channel
- Webview: Use `console.log()` in `webview-ui/src/`—output appears in browser DevTools

**Webview DevTools:**
- While debugging (F5), press `Ctrl+Shift+P` and run "Developer: Open Webview Developer Tools"
- Inspect React components, network traffic, and console output

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes and ensure tests pass: `npm run lint && npm run typecheck && npm test`
4. Commit with clear messages: `git commit -am "feat: add feature"`
5. Push to your fork and open a Pull Request

Please ensure:
- Code passes linting, type-checking, and tests
- Commit messages follow Conventional Commits
- PR includes a clear description of changes

### Known Limitations

- **Per-session settings** deferred from v1 (no concrete session-scoped controls defined)
- **Plan approval** not supported
- **Session deletion** not supported
- **Cross-device sync** not supported
- **Linux extension host** requires system libraries and display support (Electron dependencies)

### Resources

- [VS Code Extension API Docs](https://code.visualstudio.com/api)
- [@github/copilot-sdk Documentation](https://github.com/github/copilot-sdk)
- [Vitest Documentation](https://vitest.dev)
- [React Documentation](https://react.dev)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

**Questions or issues?** Please open a GitHub issue or check the [documentation](docs/) for more information.
