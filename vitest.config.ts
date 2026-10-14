import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // The reused Windows node_modules contains top-level and pnpm package copies.
    // These identity-bearing ESM packages must share one test module instance.
    alias: Object.fromEntries(
      [
        "@codemirror/state",
        "@codemirror/view",
        "@codemirror/language",
        "@codemirror/commands",
        "@lezer/common",
        "@lezer/highlight",
      ].map((name) => [
        name,
        fileURLToPath(new URL(`./node_modules/${name}/dist/index.js`, import.meta.url)),
      ]),
    ),
  },
  test: {
    // Each UI worker transforms the provider graph. CPU-count-sized pools on
    // large hosts starve polling and race tests while builds run alongside them.
    maxWorkers: 4,
    setupFiles: ["tests/browser/happy-dom-setup.ts"],
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: { deps: { inline: [/codemirror/, /lezer/] } },
  },
});
