import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url),
  vite = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const launch = (args) =>
  spawn(process.execPath, [vite, ...args], { stdio: "inherit", windowsHide: true });
const build = launch(["build", "--config", "tests/browser/vite.orchestration.config.ts"]),
  code = await new Promise((resolve) => build.on("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
const server = launch(["preview", "--config", "tests/browser/vite.orchestration.config.ts"]);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill());
server.on("exit", (code) => process.exit(code ?? 0));
