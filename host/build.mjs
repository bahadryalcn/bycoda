import { build } from "esbuild";
import { copyFile } from "node:fs/promises";

const options = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    // Bundled CommonJS dependencies such as ws still load Node builtins.
    js: "import { createRequire as __bycodaCreateRequire } from 'node:module'; var require = __bycodaCreateRequire(import.meta.url);",
  },
  loader: { ".ps1": "text", ".md": "text" },
  define: { "import.meta.hot": "undefined" },
  sourcemap: true,
};
await build({
  ...options,
  entryPoints: [
    { in: "host/cli.ts", out: "bycoda-host" },
    { in: "host/mcp-entry.ts", out: "host" },
    { in: "host/workspace-cleanup-worker.mjs", out: "workspace-cleanup-worker" },
    { in: "host/host-notes-worker.mjs", out: "host-notes-worker" },
    { in: "host/store-worker.mjs", out: "store-worker" },
    { in: "host/storage/snapshot-worker.mjs", out: "snapshot-worker" },
    { in: "host/social/audience/audience-sheet-worker.mjs", out: "audience-sheet-worker" },
    { in: "host/session-read-helper.mjs", out: "session-read-helper" },
  ],
  outdir: "build/host",
  outExtension: { ".js": ".mjs" },
});
await copyFile("host/provider-guard.mjs", "build/host/provider-guard.mjs");
