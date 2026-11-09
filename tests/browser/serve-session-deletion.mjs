import { build, preview } from "vite";

const configFile = "tests/browser/vite.session-deletion.config.ts";
await build({ configFile });
const server = await preview({ configFile });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.httpServer.close(() => process.exit(0)));
}
