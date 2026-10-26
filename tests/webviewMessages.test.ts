import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/domain/messages";

describe("webview message validation", () => {
  it("accepts supported controls and rejects untrusted payloads", () => {
    expect(
      parseWebviewMessage({
        type: "session:resume",
        sessionId: "session-123",
      }),
    ).toEqual({
      success: true,
      data: { type: "session:resume", sessionId: "session-123" },
    });
    expect(
      parseWebviewMessage({
        type: "session:select",
        sessionId: "session-123",
      }),
    ).toMatchObject({ success: true });

    expect(
      parseWebviewMessage({
        type: "permission:respond",
        requestId: "permission-123",
        decision: "approve",
        approvedForSession: true,
      }),
    ).toMatchObject({ success: false });
    expect(
      parseWebviewMessage({
        type: "message:send",
        sessionId: "",
        content: "hello",
      }),
    ).toMatchObject({ success: false });
    expect(
      parseWebviewMessage({
        type: "link:open",
        url: "https://github.com/",
      }),
    ).toMatchObject({ success: true });
    expect(
      parseWebviewMessage({
        type: "link:open",
        url: "command:workbench.action.files.openFile",
      }),
    ).toMatchObject({ success: false });
  });
});
