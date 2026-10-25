import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const config = "tests/browser/vite.text-actions.config.ts";
const build = spawn(process.execPath, [vite, "build", "--config", config], {
  stdio: "inherit",
  windowsHide: true,
});
const code = await new Promise((resolve) => build.on("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
const server = spawn(process.execPath, [vite, "preview", "--config", config], {
  stdio: "inherit",
  windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill());
server.on("exit", (code) => process.exit(code ?? 0));
