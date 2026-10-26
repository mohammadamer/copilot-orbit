import * as vscode from "vscode";
import type { CopilotSession } from "../domain/session";
import type { PendingInteraction } from "../domain/messages";
import { SessionManagementFacade } from "./sessionManagementFacade";

type SessionTreeKind = "all" | "active" | "approvals" | "projects";
type SessionTreeElement = SessionTreeItem | ProjectTreeItem | PendingApprovalTreeItem;

export class SessionTreeProvider
  implements vscode.TreeDataProvider<SessionTreeElement>
{
  private readonly changeEmitter = new vscode.EventEmitter<SessionTreeElement | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly kind: SessionTreeKind,
    private readonly getSessions: () => Promise<CopilotSession[]>,
    private readonly facade: SessionManagementFacade,
  ) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  async getChildren(element?: SessionTreeElement): Promise<SessionTreeElement[]> {
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
      const sessionsById = new Map(sessions.map((session) => [session.id, session]));
      return this.facade
        .getPendingInteractions()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((interaction) => {
          const session = sessionsById.get(interaction.sessionId);
          return new PendingApprovalTreeItem(
            interaction,
            session?.displayName ?? interaction.sessionId,
            session?.status ?? "unknown",
            session?.archived ?? false,
          );
        });
    }
    if (this.kind === "projects") {
      if (element instanceof ProjectTreeItem) {
        return sessions
          .filter((session) => getProjectKey(session) === element.projectKey)
          .map((session) => new SessionTreeItem(session));
      }
      const projects = new Map<
        string,
        { name: string; projectPath?: string }
      >();
      for (const session of sessions) {
        const projectKey = getProjectKey(session);
        if (!projects.has(projectKey)) {
          projects.set(projectKey, {
            name: session.projectName ?? "Unknown project",
            ...(session.projectPath ?? session.workingDirectory
              ? { projectPath: session.projectPath ?? session.workingDirectory }
              : {}),
          });
        }
      }
      return [...projects].map(([projectKey, project]) =>
        new ProjectTreeItem(projectKey, project),
      );
    }
    return sessions.map((session) => new SessionTreeItem(session));
  }

  getTreeItem(element: SessionTreeElement): vscode.TreeItem {
    return element;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

function getProjectKey(session: CopilotSession): string {
  return session.projectPath ?? session.projectName ?? "unknown";
}

class ProjectTreeItem extends vscode.TreeItem {
  constructor(
    readonly projectKey: string,
    project: { name: string; projectPath?: string },
  ) {
    super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = projectKey;
    this.tooltip = project.projectPath;
  }
}

class PendingApprovalTreeItem extends vscode.TreeItem {
  constructor(
    interaction: PendingInteraction,
    sessionName: string,
    status: string,
    archived: boolean,
  ) {
    super(interaction.title, vscode.TreeItemCollapsibleState.None);
    this.id = interaction.requestId;
    this.description = [
      interaction.kind,
      sessionName,
      status,
      archived ? "archived" : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    this.tooltip = `${interaction.title}\n${sessionName}\n${interaction.createdAt}`;
    this.command = {
      command: "copilotSessions.openPendingInteraction",
      title: "Open Pending Interaction",
      arguments: [interaction.requestId],
    };
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
