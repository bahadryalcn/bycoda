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
  entryPoints: ["host/cli.ts"],
  outfile: "build/host/bycoda-host.mjs",
});
await build({
  ...options,
  entryPoints: ["host/mcp-entry.ts"],
  outfile: "build/host/host.mjs",
});
await copyFile("host/provider-guard.mjs", "build/host/provider-guard.mjs");
await build({
  ...options,
  entryPoints: ["host/host-notes-worker.mjs"],
  outfile: "build/host/host-notes-worker.mjs",
});
await build({
  ...options,
  entryPoints: ["host/store-worker.mjs"],
  outfile: "build/host/store-worker.mjs",
});
await build({
  ...options,
  entryPoints: ["host/storage/snapshot-worker.mjs"],
  outfile: "build/host/snapshot-worker.mjs",
});
