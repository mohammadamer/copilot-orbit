import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { CopilotSession } from "../domain/session";
import {
  parseWebviewMessage,
  type ExtensionMessage,
  type WebviewMessage,
} from "../domain/messages";
import { SessionManagementFacade } from "./sessionManagementFacade";

const localMetadataKey = "copilotOrbit.sessionMetadata";

interface LocalSessionMetadata {
  favorite?: boolean;
  archived?: boolean;
}

export class DashboardProvider implements vscode.WebviewViewProvider {
  private readonly webviews = new Set<vscode.Webview>();
  private readonly webviewListeners = new Map<
    vscode.Webview,
    vscode.Disposable
  >();
  private readonly facadeSubscription: vscode.Disposable;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeSessions = this.changeEmitter.event;
  private pendingFocusSessionId: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly facade: SessionManagementFacade,
  ) {
    this.facadeSubscription = new vscode.Disposable(
      facade.subscribe((message) => this.broadcast(message)),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.configure(webviewView.webview);
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.onDidDispose(() => this.releaseWebview(webviewView.webview));
  }

  openDashboard(): void {
    const panel = vscode.window.createWebviewPanel(
      "copilotOrbit.dashboard",
      "Copilot Orbit",
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [this.context.extensionUri] },
    );
    this.configure(panel.webview);
    panel.webview.html = this.getHtml(panel.webview);
    panel.onDidDispose(() => this.releaseWebview(panel.webview));
  }

  async openSession(sessionId: string): Promise<void> {
    const session = (await this.sessionsWithLocalMetadata()).find(
      (item) => item.id === sessionId,
    );
    if (!session?.available) {
      throw new Error("This session is not available in the SDK catalog.");
    }
    this.pendingFocusSessionId = sessionId;
    this.openDashboard();
  }

  async copySessionId(sessionId: string): Promise<void> {
    const session = (await this.sessionsWithLocalMetadata()).find(
      (item) => item.id === sessionId,
    );
    if (!session) {
      throw new Error("This session is not available.");
    }
    await vscode.env.clipboard.writeText(session.id);
  }

  async openProject(sessionId: string): Promise<void> {
    const session = (await this.sessionsWithLocalMetadata()).find(
      (item) => item.id === sessionId,
    );
    if (!session?.workingDirectory) {
      throw new Error("This session has no known project folder.");
    }
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(session.workingDirectory),
      { forceNewWindow: false },
    );
  }

  dispose(): void {
    this.facadeSubscription.dispose();
    this.changeEmitter.dispose();
    for (const listener of this.webviewListeners.values()) {
      listener.dispose();
    }
    this.webviewListeners.clear();
    this.webviews.clear();
  }

  private configure(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    this.webviews.add(webview);
    this.webviewListeners.set(
      webview,
      webview.onDidReceiveMessage((message: unknown) =>
        this.handleWebviewMessage(webview, message),
      ),
    );
    void this.refreshCatalog().catch((error: unknown) =>
      this.reportError(error),
    );
    this.sendPreferences(webview);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Copilot Orbit</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async handleWebviewMessage(
    webview: vscode.Webview,
    message: unknown,
  ): Promise<void> {
    const parsed = parseWebviewMessage(message);
    if (!parsed.success) {
      void webview.postMessage({
        type: "error",
        message: "The requested action was invalid.",
      } satisfies ExtensionMessage);
      return;
    }

    const request = parsed.data;
    try {
      await this.dispatch(request, webview);
      if ("requestId" in request && request.requestId) {
        void webview.postMessage({
          type: "operation:result",
          requestId: request.requestId,
          success: true,
        } satisfies ExtensionMessage);
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "The operation failed.";
      void webview.postMessage({
        type: "error",
        message: messageText,
      } satisfies ExtensionMessage);
      if ("requestId" in request && request.requestId) {
        void webview.postMessage({
          type: "operation:result",
          requestId: request.requestId,
          success: false,
          message: messageText,
        } satisfies ExtensionMessage);
      }
    }
  }

  private async dispatch(
    request: WebviewMessage,
    webview: vscode.Webview,
  ): Promise<void> {
    switch (request.type) {
      case "sessions:refresh":
        await this.refreshCatalog();
        this.sendPending(webview);
        this.sendPreferences(webview);
        await this.sendPendingFocus(webview);
        return;
      case "session:resume":
        await this.facade.resumeSession(request.sessionId);
        await this.refreshCatalog();
        return;
      case "session:create": {
        const projectPath = await this.chooseWorkingDirectory();
        await this.facade.createSession(projectPath);
        await this.refreshCatalog();
        return;
      }
      case "message:send":
        await this.facade.sendMessage(request.sessionId, request.content);
        await this.refreshCatalog();
        return;
      case "run:steer":
        await this.facade.steerRun(request.sessionId, request.content);
        return;
      case "run:cancel":
        if (
          vscode.workspace
            .getConfiguration("copilotSessions")
            .get<boolean>("confirmBeforeCancel", true) &&
          !(await vscode.window.showWarningMessage(
            "Cancel the active run? The session and its history will remain.",
            { modal: true },
            "Cancel Run",
          ))
        ) {
          return;
        }
        await this.facade.cancelRun(request.sessionId);
        return;
      case "permission:respond":
        this.facade.respondToPermission(request.requestId, request.decision);
        return;
      case "question:respond":
        this.facade.respondToQuestion(request.requestId, {
          action: request.action,
          ...(request.answer !== undefined ? { answer: request.answer } : {}),
          ...(request.fields ? { fields: request.fields } : {}),
        });
        return;
      case "session:favorite":
        await this.updateLocalMetadata(request.sessionId, {
          favorite: request.favorite,
        });
        await this.refreshCatalog();
        return;
      case "session:archive":
        await this.updateLocalMetadata(request.sessionId, {
          archived: request.archived,
        });
        await this.refreshCatalog();
        return;
      case "session:metadata:remove":
        await this.removeLocalMetadata(request.sessionId);
        await this.refreshCatalog();
        return;
      case "session:copy-id": {
        await this.copySessionId(request.sessionId);
        return;
      }
      case "project:open": {
        await this.openProject(request.sessionId);
        return;
      }
    }
  }

  async refreshCatalog(): Promise<void> {
    const sessions = await this.sessionsWithLocalMetadata();
    this.changeEmitter.fire();
    this.broadcast({
      type: "sessions:loaded",
      sessions,
    } satisfies ExtensionMessage);
  }

  async sessionsWithLocalMetadata(): Promise<CopilotSession[]> {
    const sessions = await this.facade.listSessions();
    const local = this.context.globalState.get<
      Record<string, LocalSessionMetadata>
    >(localMetadataKey, {});
    const knownIds = new Set(sessions.map((session) => session.id));
    const available = sessions.map((session) => ({
      ...session,
      favorite: local[session.id]?.favorite ?? false,
      archived: local[session.id]?.archived ?? false,
      available: true,
    }));

    for (const [id, metadata] of Object.entries(local)) {
      if (!knownIds.has(id) && (metadata.favorite || metadata.archived)) {
        available.push({
          id,
          displayName: id,
          source: "unknown",
          status: "unknown",
          controlCapability: "unknown",
          canResume: false,
          canSteer: false,
          favorite: metadata.favorite ?? false,
          archived: metadata.archived ?? false,
          available: false,
        });
      }
    }
    return available;
  }

  private async updateLocalMetadata(
    sessionId: string,
    updates: LocalSessionMetadata,
  ): Promise<void> {
    const metadata = this.context.globalState.get<
      Record<string, LocalSessionMetadata>
    >(localMetadataKey, {});
    const next = {
      ...metadata,
      [sessionId]: { ...metadata[sessionId], ...updates },
    };
    if (!next[sessionId].favorite && !next[sessionId].archived) {
      delete next[sessionId];
    }
    await this.context.globalState.update(localMetadataKey, next);
  }

  private async removeLocalMetadata(sessionId: string): Promise<void> {
    const metadata = this.context.globalState.get<
      Record<string, LocalSessionMetadata>
    >(localMetadataKey, {});
    const next = { ...metadata };
    delete next[sessionId];
    await this.context.globalState.update(localMetadataKey, next);
  }

  reportError(error: unknown): void {
    const message =
      error instanceof Error ? error.message : "The operation failed.";
    this.broadcast({ type: "error", message });
  }

  refreshPreferences(): void {
    for (const webview of this.webviews) {
      this.sendPreferences(webview);
    }
  }

  private sendPending(webview: vscode.Webview): void {
    for (const interaction of this.facade.getPendingInteractions()) {
      void webview.postMessage({ type: "interaction:pending", interaction });
    }
  }

  private sendPreferences(webview: vscode.Webview): void {
    const config = vscode.workspace.getConfiguration("copilotSessions");
    void webview.postMessage({
      type: "preferences:loaded",
      showWorkingTimeline: config.get<boolean>("showWorkingTimeline", true),
      groupByProject: config.get<boolean>("groupByProject", true),
    } satisfies ExtensionMessage);
  }

  private async sendPendingFocus(webview: vscode.Webview): Promise<void> {
    if (!this.pendingFocusSessionId) {
      return;
    }
    const session = (await this.facade.listSessions()).find(
      (item) => item.id === this.pendingFocusSessionId,
    );
    if (!session) {
      throw new Error("This session is not available in the SDK catalog.");
    }
    void webview.postMessage({
      type: "session:focus",
      sessionId: this.pendingFocusSessionId,
      resume: !session.canResume,
    } satisfies ExtensionMessage);
    this.pendingFocusSessionId = undefined;
  }

  private releaseWebview(webview: vscode.Webview): void {
    this.webviews.delete(webview);
    this.webviewListeners.get(webview)?.dispose();
    this.webviewListeners.delete(webview);
  }

  private async chooseWorkingDirectory(): Promise<string | undefined> {
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

  private broadcast(message: ExtensionMessage): void {
    for (const webview of this.webviews) {
      void webview.postMessage(message);
    }
  }
}
