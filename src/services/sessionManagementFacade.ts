import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  ElicitationContext,
  ElicitationResult,
  MessageOptions,
  PermissionRequest,
  PermissionRequestResult,
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
  SessionEventHandler,
  SessionMetadata,
} from "@github/copilot-sdk";
import type {
  ConversationItem,
  ExtensionMessage,
  PendingInteraction,
  WorkingTimelineEvent,
} from "../domain/messages";
import type {
  CopilotSession,
  SessionConversationMessage,
  SessionStatus,
} from "../domain/session";

export interface ManagedSdkSession {
  readonly sessionId: string;
  on(handler: SessionEventHandler): () => void;
  getEvents(): Promise<SessionEvent[]>;
  send(prompt: string): Promise<string>;
  send(options: MessageOptions): Promise<string>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SessionCatalogProvider {
  listSessions(): Promise<SessionMetadata[]>;
  resumeSession?(
    sessionId: string,
    config: ResumeSessionConfig,
  ): Promise<ManagedSdkSession>;
  createSession?(config: SessionConfig): Promise<ManagedSdkSession>;
}

interface ManagedSessionRecord {
  session: ManagedSdkSession;
  status: SessionStatus;
  conversation: SessionConversationMessage[];
  timeline: WorkingTimelineEvent[];
  eventIds: Set<string>;
  finalizedAssistantMessageIds: Set<string>;
  hydrating: boolean;
  queuedEvents: SessionEvent[];
  unsubscribe: () => void;
}

type PendingResponse =
  | {
      kind: "permission";
      resolve: (result: PermissionRequestResult) => void;
    }
  | {
      kind: "legacy-question";
      choices: string[];
      resolve: (result: LegacyInputResponse) => void;
    }
  | {
      kind: "elicitation";
      resolve: (result: ElicitationResult) => void;
    };

interface LegacyInputRequest {
    question: string;
    choices?: string[];
    allowFreeform?: boolean;
}

interface LegacyInputResponse {
    answer: string;
    wasFreeform: boolean;
}

export class SessionManagementFacade {
  private readonly managed = new Map<string, ManagedSessionRecord>();
  private readonly resuming = new Map<string, Promise<ConversationItem[]>>();
  private readonly pending = new Map<string, PendingInteraction>();
  private readonly pendingResponses = new Map<string, PendingResponse>();
  private readonly listeners = new Set<(message: ExtensionMessage) => void>();

  constructor(private readonly sdk: SessionCatalogProvider) {}

  subscribe(listener: (message: ExtensionMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listSessions(): Promise<CopilotSession[]> {
    const sessions = await this.sdk.listSessions();

    return sessions
      .map((session) => {
        const workingDirectory = session.context?.workingDirectory;
        const projectPath = session.context?.gitRoot ?? workingDirectory;
        const projectName = projectPath
          ? basename(projectPath)
          : undefined;
        const managed = this.managed.get(session.sessionId);

        return {
          id: session.sessionId,
          displayName:
            session.summary || `Session ${session.sessionId.slice(0, 8)}`,
          ...(projectName ? { projectName } : {}),
          ...(projectPath ? { projectPath } : {}),
          source: session.isRemote ? "remote" : "local",
          createdAt: session.startTime.toISOString(),
          updatedAt: session.modifiedTime.toISOString(),
          status: managed?.status ?? "unknown",
          controlCapability: managed ? "controllable" : "resumable",
          canResume: !managed,
          canSteer: managed?.status === "running" && !this.hasPending(session.sessionId),
          ...(workingDirectory ? { workingDirectory } : {}),
        } satisfies CopilotSession;
      })
      .sort((left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
      );
  }

  getPendingInteractions(): PendingInteraction[] {
    return [...this.pending.values()];
  }

  getActiveSessionIds(): string[] {
    return [...this.managed.entries()]
      .filter(([, record]) =>
        ["running", "waiting-for-permission", "waiting-for-question"].includes(
          record.status,
        ),
      )
      .map(([sessionId]) => sessionId);
  }

  async resumeSession(sessionId: string): Promise<ConversationItem[]> {
    const existing = this.managed.get(sessionId);
    if (existing) {
      const messages = existing.conversation.map((message) => ({ ...message }));
      this.emit({ type: "conversation:loaded", sessionId, messages });
      this.emit({
        type: "timeline:updated",
        sessionId,
        events: existing.timeline.map((event) => ({ ...event })),
      });
      return messages;
    }
    const inFlight = this.resuming.get(sessionId);
    if (inFlight) {
      return inFlight;
    }
    if (!this.sdk.resumeSession) {
      throw new Error("Session resumption is not available from the SDK.");
    }

    const pending = (async () => {
      const session = await this.sdk.resumeSession?.(
        sessionId,
        this.createResumeConfig(sessionId),
      );
      if (!session) {
        throw new Error("The SDK did not return the resumed session.");
      }
      return this.manageSession(session, "idle");
    })();
    this.resuming.set(sessionId, pending);
    try {
      return await pending;
    } finally {
      this.resuming.delete(sessionId);
    }
  }

  async createSession(workingDirectory?: string): Promise<string> {
    if (!this.sdk.createSession) {
      throw new Error("Creating sessions is not available from the SDK.");
    }

    const sessionId = randomUUID();
    const session = await this.sdk.createSession({
      sessionId,
      name: "New Copilot session",
      ...(workingDirectory ? { workingDirectory } : {}),
      onPermissionRequest: (request) =>
        this.requestPermission(sessionId, request),
      onUserInputRequest: (request) =>
        this.requestLegacyQuestion(sessionId, request),
      onElicitationRequest: (context) =>
        this.requestElicitation(sessionId, context),
    });
    await this.manageSession(session, "idle");
    return sessionId;
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const record = this.requireManaged(sessionId);
    this.ensureNoPending(sessionId);
    if (record.status === "running") {
      throw new Error("A run is already active; use steer instead.");
    }
    if (record.status !== "idle" && record.status !== "failed") {
      throw new Error("The session runtime status is not verified as idle.");
    }

    const previousStatus = record.status;
    this.setStatus(sessionId, "running");
    try {
      await record.session.send(content);
    } catch (error) {
      if (this.getManagedStatus(sessionId) === "running") {
        this.setStatus(sessionId, previousStatus);
      }
      throw error;
    }
  }

  async steerRun(sessionId: string, content: string): Promise<void> {
    const record = this.requireManaged(sessionId);
    this.ensureNoPending(sessionId);
    if (record.status !== "running") {
      throw new Error("There is no active run to steer.");
    }

    await record.session.send({ prompt: content, mode: "immediate" });
  }

  async cancelRun(sessionId: string): Promise<void> {
    const record = this.requireManaged(sessionId);
    if (record.status !== "running") {
      throw new Error("There is no active run to cancel.");
    }

    await record.session.abort();
  }

  respondToPermission(requestId: string, decision: "approve" | "reject"): void {
    const response = this.pendingResponses.get(requestId);
    if (!response || response.kind !== "permission") {
      throw new Error("This permission request is no longer pending.");
    }

    this.clearPending(requestId);
    response.resolve(
      decision === "approve"
        ? { kind: "approve-once", approvedInteractively: true }
        : { kind: "denied-interactively-by-user" },
    );
  }

  respondToQuestion(
    requestId: string,
    response: {
      action: "accept" | "decline" | "cancel";
      answer?: string;
      fields?: Record<string, string | number | boolean | string[]>;
    },
  ): void {
    const pending = this.pendingResponses.get(requestId);
    if (!pending || pending.kind === "permission") {
      throw new Error("This question is no longer pending.");
    }

    if (pending.kind === "legacy-question") {
      if (response.action !== "accept" || response.answer === undefined) {
        throw new Error("This question requires a text or choice answer.");
      }
      const interaction = this.pending.get(requestId);
      const isChoice = pending.choices.includes(response.answer);
      if (
        interaction?.allowFreeform === false &&
        pending.choices.length > 0 &&
        !isChoice
      ) {
        throw new Error("Choose one of the options provided by Copilot.");
      }
      this.clearPending(requestId);
      pending.resolve({
        answer: response.answer,
        wasFreeform: !isChoice,
      });
      return;
    }

    if (response.action === "accept") {
      const interaction = this.pending.get(requestId);
      if (interaction?.elicitationMode === "form") {
        this.validateElicitationResponse(interaction, response.fields ?? {});
      } else if (interaction?.elicitationMode !== "url") {
        throw new Error("This question does not have a supported response mode.");
      }
    }
    this.clearPending(requestId);
    pending.resolve({
      action: response.action,
      ...(response.action === "accept" && response.fields
        ? { content: response.fields }
        : {}),
    });
  }

  async shutdown(): Promise<void> {
    const records = [...this.managed.values()];
    for (const record of records) {
      record.unsubscribe();
    }
    const results = await Promise.allSettled(
      records.map((record) => record.session.disconnect()),
    );
    this.managed.clear();
    this.pending.clear();
    this.pendingResponses.clear();
    const errors = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more Copilot sessions failed to disconnect.");
    }
  }

  private createResumeConfig(sessionId: string): ResumeSessionConfig {
    return {
      continuePendingWork: false,
      onPermissionRequest: (request) =>
        this.requestPermission(sessionId, request),
      onUserInputRequest: (request) =>
        this.requestLegacyQuestion(sessionId, request),
      onElicitationRequest: (context) =>
        this.requestElicitation(sessionId, context),
    };
  }

  private async manageSession(
    session: ManagedSdkSession,
    initialStatus: SessionStatus,
  ): Promise<ConversationItem[]> {
    const record: ManagedSessionRecord = {
      session,
      status: initialStatus,
      conversation: [],
      timeline: [],
      eventIds: new Set(),
      finalizedAssistantMessageIds: new Set(),
      hydrating: true,
      queuedEvents: [],
      unsubscribe: () => {},
    };
    this.managed.set(session.sessionId, record);
    record.unsubscribe = session.on((event) =>
      this.handleEvent(session.sessionId, event),
    );

    try {
      const events = await session.getEvents();
      for (const event of events) {
        this.handleEvent(session.sessionId, event, false);
      }
      record.hydrating = false;
      for (const event of record.queuedEvents) {
        this.handleEvent(session.sessionId, event);
      }
      record.queuedEvents = [];
    } catch (error) {
      record.unsubscribe();
      this.managed.delete(session.sessionId);
      try {
        await session.disconnect();
      } catch (disconnectError) {
        throw new AggregateError(
          [error, disconnectError],
          "Loading session history and disconnecting the failed session both failed.",
        );
      }
      throw error;
    }
    this.emit({
      type: "conversation:loaded",
      sessionId: session.sessionId,
      messages: record.conversation,
    });
    this.emit({
      type: "timeline:updated",
      sessionId: session.sessionId,
      events: record.timeline,
    });
    this.emit({ type: "session:status", sessionId: session.sessionId, status: record.status });
    return record.conversation.map((message) => ({ ...message }));
  }

  private handleEvent(
    sessionId: string,
    event: SessionEvent,
    notify = true,
  ): void {
    const record = this.managed.get(sessionId);
    if (!record) {
      return;
    }
    if (record.hydrating && notify) {
      record.queuedEvents.push(event);
      return;
    }
    if (record.eventIds.has(event.id)) {
      return;
    }
    record.eventIds.add(event.id);
    if (
      event.type === "assistant.message_delta" &&
      record.finalizedAssistantMessageIds.has(event.data.messageId)
    ) {
      return;
    }
    if (event.type === "assistant.message") {
      record.finalizedAssistantMessageIds.add(event.data.messageId);
    }

    const message = this.toConversationMessage(event);
    if (message) {
      const existingIndex = record.conversation.findIndex(
        (item) => item.id === message.id,
      );
      const isDelta = event.type === "assistant.message_delta";
      if (existingIndex < 0) {
        record.conversation.push(message);
      } else if (isDelta) {
        record.conversation[existingIndex] = {
          ...record.conversation[existingIndex],
          text: record.conversation[existingIndex].text + message.text,
        };
      } else {
        record.conversation[existingIndex] = message;
      }
      if (notify) {
        this.emit({
          type: "conversation:event",
          sessionId,
          message,
          ...(isDelta ? { append: true } : {}),
          ...(event.type === "assistant.message" ? { replace: true } : {}),
        });
      }
    }

    if (event.type === "tool.execution_start") {
      this.upsertTimelineEvent(sessionId, {
        id: event.data.toolCallId,
        toolName: event.data.toolTitle ?? event.data.toolName,
        status: "running",
      });
    } else if (event.type === "tool.execution_complete") {
      const timelineEvent = record.timeline.find(
        (item) => item.id === event.data.toolCallId,
      );
      if (timelineEvent) {
        this.upsertTimelineEvent(sessionId, {
          ...timelineEvent,
          status: event.data.success ? "completed" : "failed",
        });
      }
    }

    if (notify) {
      switch (event.type) {
        case "session.idle":
          this.setStatus(sessionId, "idle");
          break;
        case "session.error":
          this.setStatus(sessionId, "failed");
          this.emit({
            type: "error",
            sessionId,
            message: event.data.message,
          });
          break;
        case "assistant.message_delta":
        case "assistant.message":
        case "tool.execution_start":
        case "tool.execution_complete":
          this.setStatus(sessionId, "running");
          break;
        default:
          break;
      }
    }
  }

  private toConversationMessage(
    event: SessionEvent,
  ): SessionConversationMessage | undefined {
    if (event.type === "user.message") {
      return {
        id: event.id,
        role: "user",
        text: event.data.content,
      };
    }
    if (event.type === "assistant.message") {
      return {
        id: event.data.messageId,
        role: "assistant",
        text: event.data.content,
      };
    }
    if (event.type === "assistant.message_delta") {
      return {
        id: event.data.messageId,
        role: "assistant",
        text: event.data.deltaContent,
      };
    }
    return undefined;
  }

  private requestPermission(
    sessionId: string,
    request: PermissionRequest,
  ): Promise<PermissionRequestResult> {
    const requestId = randomUUID();
    const description =
      request.kind === "shell"
        ? `${request.intention}\n\nCommand: ${request.fullCommandText}${request.possiblePaths.length ? `\nAffected paths: ${request.possiblePaths.join(", ")}` : ""}`
        : `Requested ${request.kind} permission.`;
    const interaction: PendingInteraction = {
      requestId,
      sessionId,
      createdAt: new Date().toISOString(),
      kind: "permission",
      title: `${request.kind} permission`,
      description,
      ...(request.kind === "shell" &&
      request.requestSandboxBypass === true
        ? {
            elevatedRisk:
              request.requestSandboxPermissive === true
                ? "This command requests a permissive sandbox retry."
                : "This command requests execution outside the sandbox.",
          }
        : {}),
    };
    return new Promise((resolve) => {
      this.pending.set(requestId, interaction);
      this.pendingResponses.set(requestId, { kind: "permission", resolve });
      this.setStatus(sessionId, "waiting-for-permission");
      this.emit({ type: "interaction:pending", interaction });
    });
  }

  private requestLegacyQuestion(
    sessionId: string,
    request: LegacyInputRequest,
  ): Promise<LegacyInputResponse> {
    const requestId = randomUUID();
    const choices = request.choices ?? [];
    const interaction: PendingInteraction = {
      requestId,
      sessionId,
      createdAt: new Date().toISOString(),
      kind: "question",
      questionFormat: "legacy",
      allowFreeform: request.allowFreeform ?? true,
      title: request.question,
      description: choices.length ? "Choose an answer or enter your own." : "",
      ...(choices.length ? { choices } : {}),
    };

    return new Promise((resolve) => {
      this.pending.set(requestId, interaction);
      this.pendingResponses.set(requestId, {
        kind: "legacy-question",
        choices,
        resolve,
      });
      this.setStatus(sessionId, "waiting-for-question");
      this.emit({ type: "interaction:pending", interaction });
    });
  }

  private requestElicitation(
    sessionId: string,
    context: ElicitationContext,
  ): Promise<ElicitationResult> {
    const requestId = randomUUID();
    const schema = context.requestedSchema;
    const interaction: PendingInteraction = {
      requestId,
      sessionId,
      createdAt: new Date().toISOString(),
      kind: "question",
      questionFormat: "structured",
      elicitationMode: context.mode ?? "form",
      title: context.message,
      description: context.elicitationSource
        ? `Requested by ${context.elicitationSource}.`
        : "",
      ...(schema
        ? {
            schema: {
              properties: Object.fromEntries(
                Object.entries(schema.properties).map(([key, field]) => [
                  key,
                  {
                    type: field.type,
                    ...(field.title ? { title: field.title } : {}),
                    ...(field.description
                      ? { description: field.description }
                      : {}),
                    ...("enum" in field
                      ? { choices: field.enum }
                      : "oneOf" in field
                        ? { choices: field.oneOf.map((choice) => choice.const) }
                        : "items" in field && "enum" in field.items
                          ? { choices: field.items.enum }
                          : "items" in field && "anyOf" in field.items
                            ? {
                                choices: field.items.anyOf.map(
                                  (choice) => choice.const,
                                ),
                              }
                        : {}),
                    ...("default" in field && field.default !== undefined
                      ? { default: field.default }
                      : {}),
                    ...("minimum" in field && field.minimum !== undefined
                      ? { minimum: field.minimum }
                      : {}),
                    ...("maximum" in field && field.maximum !== undefined
                      ? { maximum: field.maximum }
                      : {}),
                    ...("minLength" in field && field.minLength !== undefined
                      ? { minLength: field.minLength }
                      : {}),
                    ...("maxLength" in field && field.maxLength !== undefined
                      ? { maxLength: field.maxLength }
                      : {}),
                    ...("minItems" in field && field.minItems !== undefined
                      ? { minItems: field.minItems }
                      : {}),
                    ...("maxItems" in field && field.maxItems !== undefined
                      ? { maxItems: field.maxItems }
                      : {}),
                  },
                ]),
              ),
              ...(schema.required ? { required: schema.required } : {}),
            },
          }
        : {}),
      ...(context.url ? { url: context.url } : {}),
    };

    return new Promise((resolve) => {
      this.pending.set(requestId, interaction);
      this.pendingResponses.set(requestId, { kind: "elicitation", resolve });
      this.setStatus(sessionId, "waiting-for-question");
      this.emit({ type: "interaction:pending", interaction });
    });
  }

  private clearPending(requestId: string): void {
    const interaction = this.pending.get(requestId);
    if (!interaction) {
      throw new Error("This interaction is no longer pending.");
    }
    this.pending.delete(requestId);
    this.pendingResponses.delete(requestId);
    this.emit({ type: "interaction:cleared", requestId });
    if (![...this.pending.values()].some((item) => item.sessionId === interaction.sessionId)) {
      this.setStatus(interaction.sessionId, "running");
    }
  }

  private hasPending(sessionId: string): boolean {
    return [...this.pending.values()].some(
      (interaction) => interaction.sessionId === sessionId,
    );
  }

  private validateElicitationResponse(
    interaction: PendingInteraction | undefined,
    fields: Record<string, string | number | boolean | string[]>,
  ): void {
    const schema = interaction?.schema;
    if (!schema) {
      throw new Error("The structured question has no response schema.");
    }
    for (const key of Object.keys(fields)) {
      const definition = schema.properties[key];
      if (!definition) {
        throw new Error(`The answer contains an unexpected field: ${key}`);
      }
      const value = fields[key];
      const validType =
        definition.type === "string"
          ? typeof value === "string"
          : definition.type === "array"
            ? Array.isArray(value) &&
              value.every((item) => typeof item === "string")
            : definition.type === "boolean"
              ? typeof value === "boolean"
              : typeof value === "number" &&
                Number.isFinite(value) &&
                (definition.type !== "integer" || Number.isInteger(value));
      if (!validType) {
        throw new Error(`The answer for ${key} has an invalid value.`);
      }
      if (
        definition.choices &&
        (typeof value === "string"
          ? !definition.choices.includes(value)
          : Array.isArray(value) &&
            value.some((item) => !definition.choices?.includes(item)))
      ) {
        throw new Error(`Choose an available value for ${key}.`);
      }
      if (
        typeof value === "string" &&
        ((definition.minLength !== undefined &&
          value.length < definition.minLength) ||
          (definition.maxLength !== undefined &&
            value.length > definition.maxLength))
      ) {
        throw new Error(`The answer for ${key} has an invalid length.`);
      }
      if (
        Array.isArray(value) &&
        ((definition.minItems !== undefined &&
          value.length < definition.minItems) ||
          (definition.maxItems !== undefined &&
            value.length > definition.maxItems))
      ) {
        throw new Error(`The answer for ${key} has an invalid number of values.`);
      }
      if (
        typeof value === "number" &&
        ((definition.minimum !== undefined && value < definition.minimum) ||
          (definition.maximum !== undefined && value > definition.maximum))
      ) {
        throw new Error(`The answer for ${key} is outside the allowed range.`);
      }
    }
    for (const required of schema.required ?? []) {
      if (!(required in fields)) {
        throw new Error(`The answer is missing ${required}.`);
      }
    }
  }

  private ensureNoPending(sessionId: string): void {
    if (this.hasPending(sessionId)) {
      throw new Error("Respond to the pending interaction before sending a message.");
    }
  }

  private upsertTimelineEvent(
    sessionId: string,
    event: WorkingTimelineEvent,
  ): void {
    const record = this.managed.get(sessionId);
    if (!record) {
      return;
    }
    const existingIndex = record.timeline.findIndex(
      (item) => item.id === event.id,
    );
    if (existingIndex < 0) {
      record.timeline.push(event);
    } else {
      record.timeline[existingIndex] = event;
    }
    if (record.timeline.length > 100) {
      record.timeline.splice(0, record.timeline.length - 100);
    }
    this.emit({
      type: "timeline:updated",
      sessionId,
      events: record.timeline.map((item) => ({ ...item })),
    });
  }

  private requireManaged(sessionId: string): ManagedSessionRecord {
    const record = this.managed.get(sessionId);
    if (!record) {
      throw new Error("Resume this session before using runtime controls.");
    }
    return record;
  }

  private setStatus(sessionId: string, status: SessionStatus): void {
    const record = this.managed.get(sessionId);
    if (!record || record.status === status) {
      return;
    }
    record.status = status;
    this.emit({ type: "session:status", sessionId, status });
  }

  private getManagedStatus(sessionId: string): SessionStatus | undefined {
    return this.managed.get(sessionId)?.status;
  }

  private emit(message: ExtensionMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}
