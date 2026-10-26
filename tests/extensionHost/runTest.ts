import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const userDataDir = mkdtempSync(join(tmpdir(), "copilot-orbit-vscode-"));
  const userDirectory = join(userDataDir, "User");
  mkdirSync(userDirectory, { recursive: true });
  writeFileSync(
    join(userDirectory, "settings.json"),
    JSON.stringify({
      "copilotSessions.cliPath": join(userDataDir, "unavailable-copilot-cli"),
    }),
  );

  try {
    await runTests({
      extensionDevelopmentPath: resolve(__dirname, "../../../.."),
      extensionTestsPath: resolve(__dirname, "suite"),
      launchArgs: [
        `--user-data-dir=${userDataDir}`,
        "--disable-workspace-trust",
        "--skip-welcome",
      ],
    });
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error("VS Code extension-host tests failed:", error);
  process.exitCode = 1;
});
