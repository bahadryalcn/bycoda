import { build } from "esbuild";
import { copyFile } from "node:fs/promises";

const options = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  loader: { ".ps1": "text" },
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
