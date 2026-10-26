import * as assert from "assert";
import * as vscode from "vscode";

suite("Copilot Orbit extension host", () => {
  test("activates and registers the dashboard command", async () => {
    const extension = vscode.extensions.getExtension(
      "copilot-orbit.copilot-orbit",
    );
    assert.ok(extension, "Copilot Orbit should be available in the test host");

    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("copilotSessions.openDashboard"),
      "the dashboard command should be registered",
    );
  });
});
