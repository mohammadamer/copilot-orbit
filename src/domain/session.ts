export type SessionStatus =
  | "idle"
  | "running"
  | "waiting-for-permission"
  | "waiting-for-question"
  | "completed"
  | "failed"
  | "unknown";

export type SessionSource = "local" | "remote" | "unknown";

export type SessionControlCapability =
  | "controllable"
  | "resumable"
  | "read-only"
  | "unknown";

export interface CopilotSession {
  id: string;
  displayName: string;
  projectName?: string;
  projectPath?: string;
  source: SessionSource;
  createdAt?: string;
  updatedAt?: string;
  status: SessionStatus;
  controlCapability: SessionControlCapability;
  canResume: boolean;
  canSteer: boolean;
  model?: string;
  workingDirectory?: string;
  messageCount?: number;
  favorite?: boolean;
  archived?: boolean;
  available?: boolean;
}

export interface SessionConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
}
