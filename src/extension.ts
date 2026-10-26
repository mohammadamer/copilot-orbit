import * as vscode from "vscode";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { DashboardProvider } from "./services/dashboardProvider";
import { SessionManagementFacade } from "./services/sessionManagementFacade";
import { SessionTreeProvider } from "./services/sessionTreeProvider";

let shutdown: (() => Promise<void>) | undefined;
let shutdownPromise: Promise<void> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("copilotSessions");
  const cliPath = config.get<string>("cliPath", "").trim();
  const client = new CopilotClient({
    ...(cliPath
      ? { connection: RuntimeConnection.forStdio({ path: cliPath }) }
      : {}),
    logLevel: config.get("logLevel", "info"),
  });
  const facade = new SessionManagementFacade(client);
  const dashboard = new DashboardProvider(context, facade);
  const activeSessions = new SessionTreeProvider(
    "active",
    () => dashboard.sessionsWithLocalMetadata(),
    facade,
  );
  const approvals = new SessionTreeProvider(
    "approvals",
    () => dashboard.sessionsWithLocalMetadata(),
    facade,
  );
  const trees = [activeSessions, approvals];
  const refreshTrees = facade.subscribe(() => {
    for (const tree of trees) {
      tree.refresh();
    }
  });
  const refreshFromCatalog = dashboard.onDidChangeSessions(() => {
    for (const tree of trees) {
      tree.refresh();
    }
  });

  context.subscriptions.push(
    dashboard,
    activeSessions,
    approvals,
    new vscode.Disposable(refreshTrees),
    refreshFromCatalog,
    vscode.window.registerWebviewViewProvider(
      "copilotOrbit.sessions",
      dashboard,
    ),
    vscode.window.registerTreeDataProvider(
      "copilotOrbit.active",
      activeSessions,
    ),
    vscode.window.registerTreeDataProvider(
      "copilotOrbit.approvals",
      approvals,
    ),
    vscode.commands.registerCommand("copilotSessions.openDashboard", () =>
      dashboard.openDashboard(),
    ),
    vscode.commands.registerCommand(
      "copilotSessions.openSession",
      (sessionId: string) => dashboard.openSession(sessionId),
    ),
    vscode.commands.registerCommand(
      "copilotSessions.copySessionId",
      async (sessionId?: string) => {
        const selectedId = sessionId ?? (await chooseKnownSession(dashboard));
        if (selectedId) {
          await dashboard.copySessionId(selectedId);
        }
      },
    ),
    vscode.commands.registerCommand(
      "copilotSessions.openProject",
      async (sessionId?: string) => {
        const selectedId =
          sessionId ?? (await chooseSessionWithProject(dashboard));
        if (selectedId) {
          await dashboard.openProject(selectedId);
        }
      },
    ),
    vscode.commands.registerCommand(
      "copilotSessions.refreshSessions",
      async () => {
        await dashboard.refreshCatalog();
      },
    ),
    vscode.commands.registerCommand(
      "copilotSessions.createSession",
      async () => {
        const projectPath = await chooseWorkingDirectory();
        const sessionId = await facade.createSession(projectPath);
        await dashboard.openSession(sessionId);
        for (const tree of trees) {
          tree.refresh();
        }
      },
    ),
    vscode.commands.registerCommand(
      "copilotSessions.resumeSession",
      async (sessionId?: string) => {
        const selectedId =
          sessionId ?? (await chooseSession(dashboard));
        if (selectedId) {
          await facade.resumeSession(selectedId);
          await dashboard.openSession(selectedId);
        }
      },
    ),
    vscode.commands.registerCommand(
      "copilotSessions.cancelRun",
      async (sessionId?: string) => {
        const selectedId =
          sessionId ?? (await chooseActiveSession(dashboard));
        if (selectedId) {
          const shouldConfirm = vscode.workspace
            .getConfiguration("copilotSessions")
            .get<boolean>("confirmBeforeCancel", true);
          const confirmed = shouldConfirm
            ? await vscode.window.showWarningMessage(
                "Cancel the active run? The session and its history will remain.",
                { modal: true },
                "Cancel Run",
              )
            : "Cancel Run";
          if (confirmed) {
            await facade.cancelRun(selectedId);
          }
        }
      },
    ),
    vscode.commands.registerCommand(
      "copilotSessions.showPendingApprovals",
      () => vscode.commands.executeCommand("copilotOrbit.approvals.focus"),
    ),
  );

  shutdown = async () => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = undefined;
        }
        await facade.shutdown();
        const errors = await client.stop();
        if (errors.length > 0) {
          for (const error of errors) {
            output.appendLine(`SDK shutdown error: ${error.message}`);
          }
          output.show(true);
        }
      })();
    }
    await shutdownPromise;
  };
  context.subscriptions.push({ dispose: () => void shutdown?.() });

  const output = vscode.window.createOutputChannel("Copilot Orbit");
  context.subscriptions.push(output);
  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    const currentConfig = vscode.workspace.getConfiguration("copilotSessions");
    if (currentConfig.get<boolean>("autoRefresh", true)) {
      const interval = currentConfig.get<number>("refreshInterval", 30);
      refreshTimer = setInterval(() => {
        void dashboard
          .refreshCatalog()
          .catch((error: unknown) => dashboard.reportError(error));
      }, interval * 1000);
    }
  };
  scheduleRefresh();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("copilotSessions")) {
        dashboard.refreshPreferences();
        scheduleRefresh();
      }
    }),
  );

  try {
    await client.start();
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown runtime startup error.";
    void vscode.window.showErrorMessage(
      `Copilot Orbit could not start the Copilot runtime: ${reason}`,
    );
    dashboard.reportError(error);
  }
}

export async function deactivate(): Promise<void> {
  await shutdown?.();
}

async function chooseWorkingDirectory(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Use Folder",
    title: "Choose a project for the new Copilot session",
  });
  if (!selected?.[0]) {
    throw new Error("Choose a project folder to create a session.");
  }
  return selected[0].fsPath;
}

async function chooseSession(
  dashboard: DashboardProvider,
): Promise<string | undefined> {
  const sessions = await dashboard.sessionsWithLocalMetadata();
  const selected = await vscode.window.showQuickPick(
    sessions
      .filter((session) => session.canResume)
      .map((session) => ({
        label: session.displayName,
        description: session.projectName,
        detail: session.id,
        sessionId: session.id,
      })),
    { placeHolder: "Choose a Copilot session to resume" },
  );
  return selected?.sessionId;
}

async function chooseActiveSession(
  dashboard: DashboardProvider,
): Promise<string | undefined> {
  const sessions = await dashboard.sessionsWithLocalMetadata();
  const active = sessions.filter((session) => session.status === "running");
  if (active.length === 1) {
    return active[0].id;
  }
  const selected = await vscode.window.showQuickPick(
    active.map((session) => ({
      label: session.displayName,
      description: session.projectName,
      detail: session.id,
      sessionId: session.id,
    })),
    { placeHolder: "Choose an active Copilot run to cancel" },
  );
  return selected?.sessionId;
}

async function chooseKnownSession(
  dashboard: DashboardProvider,
): Promise<string | undefined> {
  const sessions = await dashboard.sessionsWithLocalMetadata();
  const selected = await vscode.window.showQuickPick(
    sessions.map((session) => ({
      label: session.displayName,
      description: session.projectName,
      detail: session.id,
      sessionId: session.id,
    })),
    { placeHolder: "Choose a Copilot session" },
  );
  return selected?.sessionId;
}

async function chooseSessionWithProject(
  dashboard: DashboardProvider,
): Promise<string | undefined> {
  const sessions = await dashboard.sessionsWithLocalMetadata();
  const selected = await vscode.window.showQuickPick(
    sessions
      .filter((session) => session.workingDirectory)
      .map((session) => ({
        label: session.displayName,
        description: session.projectName,
        detail: session.workingDirectory,
        sessionId: session.id,
      })),
    { placeHolder: "Choose a session project to open" },
  );
  return selected?.sessionId;
}
