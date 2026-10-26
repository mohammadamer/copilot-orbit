import { z } from "zod";
import type { CopilotSession, SessionStatus } from "./session";

const sessionId = z.string().trim().min(1).max(200);

const requestId = z.string().trim().min(1).max(200).optional();

function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const webviewMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sessions:refresh"), requestId }).strict(),
  z.object({ type: z.literal("session:select"), sessionId }).strict(),
  z.object({ type: z.literal("session:resume"), sessionId, requestId }).strict(),
  z.object({ type: z.literal("session:create"), projectPath: z.string().min(1).optional(), requestId }).strict(),
  z.object({ type: z.literal("message:send"), sessionId, content: z.string().trim().min(1).max(100_000), requestId }).strict(),
  z.object({ type: z.literal("run:steer"), sessionId, content: z.string().trim().min(1).max(100_000), requestId }).strict(),
  z.object({ type: z.literal("run:cancel"), sessionId, requestId }).strict(),
  z.object({
    type: z.literal("permission:respond"),
    requestId: z.string().trim().min(1).max(200),
    decision: z.enum(["approve", "reject"]),
  }).strict(),
  z.object({
    type: z.literal("question:respond"),
    requestId: z.string().trim().min(1).max(200),
    action: z.enum(["accept", "decline", "cancel"]),
    answer: z.string().max(20_000).optional(),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
  }).strict(),
  z.object({
    type: z.literal("link:open"),
    url: z
      .string()
      .max(2_048)
      .refine(isSafeExternalUrl, "Only HTTP and HTTPS links are allowed."),
    requestId,
  }).strict(),
  z.object({ type: z.literal("session:favorite"), sessionId, favorite: z.boolean(), requestId }).strict(),
  z.object({ type: z.literal("session:archive"), sessionId, archived: z.boolean(), requestId }).strict(),
  z.object({ type: z.literal("session:metadata:remove"), sessionId, requestId }).strict(),
  z.object({ type: z.literal("session:copy-id"), sessionId, requestId }).strict(),
  z.object({ type: z.literal("project:open"), sessionId, requestId }).strict(),
]);

export type WebviewMessage = z.infer<typeof webviewMessageSchema>;

export function parseWebviewMessage(message: unknown) {
  return webviewMessageSchema.safeParse(message);
}

export interface ConversationItem {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  createdAt?: string;
}

export interface PendingInteraction {
  requestId: string;
  sessionId: string;
  createdAt: string;
  kind: "permission" | "question";
  title: string;
  description: string;
  questionFormat?: "legacy" | "structured";
  elicitationMode?: "form" | "url";
  url?: string;
  allowFreeform?: boolean;
  elevatedRisk?: string;
  choices?: string[];
  schema?: {
    properties: Record<
      string,
      {
        type: "string" | "array" | "number" | "integer" | "boolean";
        title?: string;
        description?: string;
        choices?: string[];
        default?: string | number | boolean | string[];
        minimum?: number;
        maximum?: number;
        minLength?: number;
        maxLength?: number;
        minItems?: number;
        maxItems?: number;
      }
    >;
    required?: string[];
  };
}

export interface WorkingTimelineEvent {
  id: string;
  toolName: string;
  status: "running" | "completed" | "failed";
}

export type ExtensionMessage =
  | { type: "sessions:loaded"; sessions: CopilotSession[] }
  | { type: "session:focus"; sessionId: string; resume: boolean }
  | { type: "conversation:loaded"; sessionId: string; messages: ConversationItem[] }
  | {
      type: "conversation:event";
      sessionId: string;
      message: ConversationItem;
      append?: boolean;
      replace?: boolean;
    }
  | { type: "session:status"; sessionId: string; status: SessionStatus }
  | { type: "timeline:updated"; sessionId: string; events: WorkingTimelineEvent[] }
  | { type: "interaction:pending"; interaction: PendingInteraction }
  | { type: "interaction:cleared"; requestId: string }
  | { type: "operation:result"; requestId: string; success: boolean; message?: string }
  | { type: "preferences:loaded"; showWorkingTimeline: boolean; groupByProject: boolean }
  | { type: "error"; sessionId?: string; message: string };
