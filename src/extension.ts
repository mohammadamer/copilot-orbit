import * as vscode from "vscode";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { DashboardProvider } from "./services/dashboardProvider";
import { SessionManagementFacade } from "./services/sessionManagementFacade";
import { SessionTreeProvider } from "./services/sessionTreeProvider";

let shutdown: (() => Promise<void>) | undefined;
let shutdownPromise: Promise<void> | undefined;
let lifecycleRefreshTimer: NodeJS.Timeout | undefined;

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
  const projects = new SessionTreeProvider(
    "projects",
    () => dashboard.sessionsWithLocalMetadata(),
    facade,
  );
  const allSessions = new SessionTreeProvider(
    "all",
    () => dashboard.sessionsWithLocalMetadata(),
    facade,
  );
  const approvalsView = vscode.window.createTreeView("copilotOrbit.approvals", {
    treeDataProvider: approvals,
  });
  const updateApprovalsBadge = () => {
    const count = facade.getPendingInteractions().length;
    approvalsView.badge = count
      ? { value: count, tooltip: `${count} pending interactions` }
      : undefined;
  };
  updateApprovalsBadge();
  const trees = [allSessions, activeSessions, approvals, projects];
  const refreshTrees = facade.subscribe(() => {
    for (const tree of trees) {
      tree.refresh();
    }
    updateApprovalsBadge();
  });
  const refreshFromCatalog = dashboard.onDidChangeSessions(() => {
    for (const tree of trees) {
      tree.refresh();
    }
  });
  const refreshFromLifecycle = client.onLifecycle((event) => {
    if (
      event.type === "session.created" ||
      event.type === "session.deleted" ||
      event.type === "session.updated"
    ) {
      if (lifecycleRefreshTimer) {
        clearTimeout(lifecycleRefreshTimer);
      }
      lifecycleRefreshTimer = setTimeout(() => {
        lifecycleRefreshTimer = undefined;
        void dashboard
          .refreshCatalog()
          .catch((error: unknown) => dashboard.reportError(error));
      }, 100);
    }
  });

  context.subscriptions.push(
    dashboard,
    activeSessions,
    approvals,
    projects,
    allSessions,
    approvalsView,
    new vscode.Disposable(refreshTrees),
    new vscode.Disposable(() => {
      refreshFromLifecycle();
      if (lifecycleRefreshTimer) {
        clearTimeout(lifecycleRefreshTimer);
        lifecycleRefreshTimer = undefined;
      }
    }),
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
      "copilotOrbit.allSessions",
      allSessions,
    ),
    vscode.window.registerTreeDataProvider("copilotOrbit.projects", projects),
    vscode.commands.registerCommand("copilotSessions.openDashboard", () =>
      dashboard.openDashboard(),
    ),
    vscode.commands.registerCommand(
      "copilotSessions.openSession",
      async (sessionId?: string) => {
        const selectedId = sessionId ?? (await chooseAvailableSession(dashboard));
        if (selectedId) {
          await dashboard.openSession(selectedId);
        }
      },
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
      "copilotSessions.openPendingInteraction",
      (requestId: string) => dashboard.openPendingInteraction(requestId),
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
        if (lifecycleRefreshTimer) {
          clearTimeout(lifecycleRefreshTimer);
          lifecycleRefreshTimer = undefined;
        }
        const errors: unknown[] = [];
        if (facade.getActiveSessionIds().length > 0) {
          output.appendLine(
            "Stopping the SDK client; active work may not continue after VS Code shuts down.",
          );
        }
        try {
          await facade.shutdown();
        } catch (error) {
          errors.push(error);
        }
        try {
          errors.push(...(await client.stop()));
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 0) {
          for (const error of errors) {
            output.appendLine(
              `SDK shutdown error: ${error instanceof Error ? error.message : String(error)}`,
            );
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

async function chooseAvailableSession(
  dashboard: DashboardProvider,
): Promise<string | undefined> {
  const sessions = await dashboard.sessionsWithLocalMetadata();
  const selected = await vscode.window.showQuickPick(
    sessions
      .filter((session) => session.available !== false)
      .map((session) => ({
        label: session.displayName,
        description: session.projectName,
        detail: session.id,
        sessionId: session.id,
      })),
    { placeHolder: "Choose a Copilot session to open" },
  );
  return selected?.sessionId;
}

async function chooseSessionWithProject(
  dashboard: DashboardProvider,
): Promise<string | undefined> {
  const sessions = await dashboard.sessionsWithLocalMetadata();
  const selected = await vscode.window.showQuickPick(
    sessions
      .filter((session) => session.projectPath || session.workingDirectory)
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
