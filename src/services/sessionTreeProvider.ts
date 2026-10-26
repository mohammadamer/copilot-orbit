import * as vscode from "vscode";
import type { CopilotSession } from "../domain/session";
import { SessionManagementFacade } from "./sessionManagementFacade";

type SessionTreeKind = "all" | "active" | "approvals";

export class SessionTreeProvider
  implements vscode.TreeDataProvider<SessionTreeItem>
{
  private readonly changeEmitter = new vscode.EventEmitter<
    SessionTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly kind: SessionTreeKind,
    private readonly getSessions: () => Promise<CopilotSession[]>,
    private readonly facade: SessionManagementFacade,
  ) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  async getChildren(): Promise<SessionTreeItem[]> {
    const sessions = await this.getSessions();
    if (this.kind === "active") {
      return sessions
        .filter(
          (session) =>
            session.status === "running" ||
            session.status === "waiting-for-permission" ||
            session.status === "waiting-for-question",
        )
        .map((session) => new SessionTreeItem(session));
    }
    if (this.kind === "approvals") {
      const pendingIds = new Set(
        this.facade
          .getPendingInteractions()
          .map((interaction) => interaction.sessionId),
      );
      return sessions
        .filter((session) => pendingIds.has(session.id))
        .map((session) => new SessionTreeItem(session));
    }
    return sessions.map((session) => new SessionTreeItem(session));
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

class SessionTreeItem extends vscode.TreeItem {
  constructor(session: CopilotSession) {
    super(session.displayName, vscode.TreeItemCollapsibleState.None);
    this.description = [
      session.projectName,
      session.status === "unknown" ? "status unknown" : session.status,
      session.archived ? "archived" : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    this.tooltip = `${session.displayName}\n${session.id}\n${session.controlCapability}`;
    this.contextValue = session.available === false
      ? "copilotOrbit.unavailableSession"
      : "copilotOrbit.session";
    this.iconPath = new vscode.ThemeIcon(
      session.status === "running" ? "play-circle" : "comment-discussion",
    );
    if (session.available !== false) {
      this.command = {
        command: "copilotSessions.openSession",
        title: "Open Copilot Session",
        arguments: [session.id],
      };
    }
  }
}
