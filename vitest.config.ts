import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/sessionManagementFacade.test.ts",
      "tests/webviewMessages.test.ts",
    ],
  },
});
