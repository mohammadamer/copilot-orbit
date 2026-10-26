import { describe, expect, it } from "vitest";
import type {
  ElicitationContext,
  MessageOptions,
  PermissionRequest,
  ResumeSessionConfig,
  SessionEvent,
  SessionEventHandler,
  SessionMetadata,
} from "@github/copilot-sdk";
import {
  SessionManagementFacade,
  type ManagedSdkSession,
  type SessionCatalogProvider,
} from "../src/services/sessionManagementFacade";

class FakeSession implements ManagedSdkSession {
  readonly sent: Array<string | MessageOptions> = [];
  private readonly handlers = new Set<SessionEventHandler>();

  constructor(
    readonly sessionId: string,
    private readonly events: SessionEvent[] = [],
  ) {}

  on(handler: SessionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getEvents(): Promise<SessionEvent[]> {
    return Promise.resolve(this.events);
  }

  emit(event: SessionEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  send(prompt: string): Promise<string>;
  send(options: MessageOptions): Promise<string>;
  async send(prompt: string | MessageOptions): Promise<string> {
    this.sent.push(prompt);
    return "message-id";
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

describe("session catalog", () => {
  it("preserves SDK identity and reports only evidenced metadata", async () => {
    const sdkSessions: SessionMetadata[] = [
      {
        sessionId: "a3f45f87-1234-4bdc-a111-abcdef012345",
        startTime: new Date("2026-10-25T10:00:00.000Z"),
        modifiedTime: new Date("2026-10-26T11:30:00.000Z"),
        summary: "Investigate the failing build",
        isRemote: false,
        context: {
          workingDirectory: "/workspaces/sample-project",
          gitRoot: "/workspaces/sample-project",
          repository: "octo/sample-project",
        },
      },
      {
        sessionId: "session-without-summary",
        startTime: new Date("2026-10-24T10:00:00.000Z"),
        modifiedTime: new Date("2026-10-24T10:00:00.000Z"),
        isRemote: true,
      },
    ];
    const facade = new SessionManagementFacade({
      listSessions: async () => sdkSessions,
    });

    await expect(facade.listSessions()).resolves.toEqual([
      {
        id: "a3f45f87-1234-4bdc-a111-abcdef012345",
        displayName: "Investigate the failing build",
        projectName: "sample-project",
        source: "local",
        createdAt: "2026-10-25T10:00:00.000Z",
        updatedAt: "2026-10-26T11:30:00.000Z",
        status: "unknown",
        controlCapability: "resumable",
        canResume: true,
        canSteer: false,
        workingDirectory: "/workspaces/sample-project",
      },
      {
        id: "session-without-summary",
        displayName: "session-without-summary",
        source: "remote",
        createdAt: "2026-10-24T10:00:00.000Z",
        updatedAt: "2026-10-24T10:00:00.000Z",
        status: "unknown",
        controlCapability: "resumable",
        canResume: true,
        canSteer: false,
      },
    ]);
  });
});

describe("managed session controls", () => {
  it("loads conversation text using stable SDK message identities", async () => {
    const sessionId = "history-session";
    const assistantMessage: SessionEvent = {
      type: "assistant.message",
      id: "event-1",
      parentId: null,
      timestamp: "2026-10-25T10:00:00.000Z",
      data: {
        messageId: "assistant-message-1",
        content: "The build succeeds.",
      },
    };
    const session = new FakeSession(sessionId, [assistantMessage]);
    const facade = new SessionManagementFacade({
      listSessions: async () => [
        {
          sessionId,
          startTime: new Date("2026-10-24T10:00:00.000Z"),
          modifiedTime: new Date("2026-10-25T10:00:00.000Z"),
          isRemote: false,
        },
      ],
      resumeSession: async () => session,
    });

    await expect(facade.resumeSession(sessionId)).resolves.toEqual([
      {
        id: "assistant-message-1",
        role: "assistant",
        text: "The build succeeds.",
      },
    ]);
    await expect(facade.listSessions()).resolves.toMatchObject([
      {
        id: sessionId,
        status: "idle",
        controlCapability: "controllable",
      },
    ]);
  });

  it("merges streaming deltas and final assistant text without duplication", async () => {
    const sessionId = "streaming-session";
    const session = new FakeSession(sessionId);
    const facade = new SessionManagementFacade({
      listSessions: async () => [],
      resumeSession: async () => session,
    });
    await facade.resumeSession(sessionId);

    session.emit({
      type: "assistant.message_delta",
      id: "delta-event",
      parentId: null,
      timestamp: "2026-10-25T10:00:00.000Z",
      ephemeral: true,
      data: {
        messageId: "assistant-message-1",
        deltaContent: "Build ",
      },
    });
    session.emit({
      type: "assistant.message",
      id: "final-event",
      parentId: "delta-event",
      timestamp: "2026-10-25T10:00:01.000Z",
      data: {
        messageId: "assistant-message-1",
        content: "Build succeeds.",
      },
    });

    await expect(facade.resumeSession(sessionId)).resolves.toEqual([
      {
        id: "assistant-message-1",
        role: "assistant",
        text: "Build succeeds.",
      },
    ]);
  });

  it("resumes the existing identity once and enables managed controls", async () => {
    const sessionId = "existing-session";
    const session = new FakeSession(sessionId);
    let resumeCalls = 0;
    let resolveResume!: (value: ManagedSdkSession) => void;
    const resumeResponse = new Promise<ManagedSdkSession>((resolve) => {
      resolveResume = resolve;
    });
    const sdk: SessionCatalogProvider = {
      listSessions: async () => [
        {
          sessionId,
          startTime: new Date("2026-10-24T10:00:00.000Z"),
          modifiedTime: new Date("2026-10-25T10:00:00.000Z"),
          isRemote: false,
        },
      ],
      resumeSession: async (requestedId) => {
        expect(requestedId).toBe(sessionId);
        resumeCalls += 1;
        return resumeResponse;
      },
    };
    const facade = new SessionManagementFacade(sdk);

    const first = facade.resumeSession(sessionId);
    const second = facade.resumeSession(sessionId);
    expect(resumeCalls).toBe(1);
    resolveResume(session);

    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    await expect(facade.listSessions()).resolves.toMatchObject([
      {
        id: sessionId,
        controlCapability: "controllable",
        status: "idle",
        canResume: false,
      },
    ]);
    await facade.sendMessage(sessionId, "Continue");
    expect(session.sent).toEqual(["Continue"]);
  });

  it("starts a new session idle and accepts a single permission decision", async () => {
    let createdSession: FakeSession | undefined;
    let resumeConfig: ResumeSessionConfig | undefined;
    const sdk: SessionCatalogProvider = {
      listSessions: async () => [],
      createSession: async (config) => {
        createdSession = new FakeSession(config.sessionId ?? "new-session");
        return createdSession;
      },
      resumeSession: async (sessionId, config) => {
        resumeConfig = config;
        return new FakeSession(sessionId);
      },
    };
    const facade = new SessionManagementFacade(sdk);
    const newSessionId = await facade.createSession("/workspace/project");

    await facade.sendMessage(newSessionId, "Run the tests");
    expect(createdSession?.sent).toEqual(["Run the tests"]);

    await facade.resumeSession("existing-session");
    const permissionRequest: PermissionRequest = {
      kind: "shell",
      canOfferSessionApproval: false,
      commands: [],
      fullCommandText: "npm test",
      hasWriteFileRedirection: false,
      intention: "Run the project tests",
      possiblePaths: [],
      possibleUrls: [],
    };
    const permissionHandler = resumeConfig?.onPermissionRequest;
    expect(permissionHandler).toBeDefined();
    const pendingResponse = permissionHandler?.(permissionRequest, {
      sessionId: "existing-session",
    });
    const pendingInteraction = facade.getPendingInteractions()[0];
    expect(pendingInteraction).toMatchObject({
      kind: "permission",
      title: "shell permission",
      description: "Run the project tests\n\nCommand: npm test",
    });

    facade.respondToPermission(pendingInteraction.requestId, "approve");
    await expect(pendingResponse).resolves.toEqual({
      kind: "approve-once",
      approvedInteractively: true,
    });
    expect(() =>
      facade.respondToPermission(pendingInteraction.requestId, "reject"),
    ).toThrow("no longer pending");
  });

  it("validates structured question responses before resolving the SDK request", async () => {
    let resumeConfig: ResumeSessionConfig | undefined;
    const facade = new SessionManagementFacade({
      listSessions: async () => [],
      resumeSession: async (sessionId, config) => {
        resumeConfig = config;
        return new FakeSession(sessionId);
      },
    });
    await facade.resumeSession("elicitation-session");
    const question: ElicitationContext = {
      sessionId: "elicitation-session",
      message: "What is your age?",
      requestedSchema: {
        type: "object",
        properties: {
          age: { type: "integer", minimum: 18, maximum: 120 },
        },
        required: ["age"],
      },
    };
    const elicitationHandler = resumeConfig?.onElicitationRequest;
    expect(elicitationHandler).toBeDefined();
    if (!elicitationHandler) {
      throw new Error("The SDK elicitation handler was not configured.");
    }
    const responsePromise = elicitationHandler(question);
    const [interaction] = facade.getPendingInteractions();

    expect(() =>
      facade.respondToQuestion(interaction.requestId, {
        action: "accept",
        fields: { age: 17 },
      }),
    ).toThrow("outside the allowed range");
    expect(facade.getPendingInteractions()).toHaveLength(1);

    facade.respondToQuestion(interaction.requestId, {
      action: "accept",
      fields: { age: 25 },
    });
    await expect(responsePromise).resolves.toEqual({
      action: "accept",
      content: { age: 25 },
    });
  });
});
