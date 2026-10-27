import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const config = "tests/browser/composer-host-compatibility.vite.config.ts";
const launch = (args) =>
  spawn(process.execPath, [vite, ...args, "--config", config], {
    stdio: "inherit",
    windowsHide: true,
  });
const build = launch(["build"]);
const code = await new Promise((resolve) => build.on("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
const server = launch(["preview"]);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill());
server.on("exit", (code) => process.exit(code ?? 0));
