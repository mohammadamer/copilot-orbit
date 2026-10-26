import * as esbuild from "esbuild";
import { mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const extension = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode", "@github/copilot-sdk"],
  sourcemap: true,
};
const webview = {
  entryPoints: ["webview-ui/src/main.tsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  outfile: "dist/webview.js",
  sourcemap: true,
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
    ".css": "css",
  },
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

if (watch) {
  const extensionContext = await esbuild.context(extension);
  const webviewContext = await esbuild.context(webview);
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
  console.log("Watching extension and webview bundles.");
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
  console.log("Built Copilot Orbit extension and webview.");
}
