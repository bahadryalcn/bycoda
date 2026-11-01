import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const launch = args => spawn(process.execPath, [vite, ...args, "--config", "tests/browser/tooltip-policy.vite.config.ts"], { stdio: "inherit", windowsHide: true });
// Explicit opt-in for a spec-only rerun against the unchanged fixture build.
if (process.env.TOOLTIP_POLICY_PREVIEW_EXISTING !== "1") {
  const build = launch(["build"]);
  const result = await new Promise(resolve => build.on("exit", resolve));
  if (result !== 0) process.exit(result ?? 1);
}
const server = launch(["preview"]);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill());
server.on("exit", code => process.exit(code ?? 0));
