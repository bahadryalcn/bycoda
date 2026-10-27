import { build, createServer, preview } from "vite";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { manifest, repositoryRoot, artifactPath } from "./browser-test-support.mjs";

const id = process.argv[process.argv.indexOf("--suite") + 1];
const suite = manifest.suites.find((entry) => entry.id === id);
if (!suite) throw new Error(`Unknown fixture suite: ${id}`);
const runDirectory = artifactPath(
  process.env.BYCODA_BROWSER_RUN_DIR ?? `temp/test-results/browser-direct/${process.pid}`,
);
mkdirSync(runDirectory, { recursive: true });
const port = Number(process.env.BYCODA_BROWSER_PORT ?? suite.fixture.fixedPort ?? 0);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error("An allocated loopback fixture port is required.");
let server;
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  if (server?.close) await server.close();
  else if (server?.httpServer) await new Promise((done) => server.httpServer.close(done));
  process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
const options = {
  configFile: resolve(repositoryRoot, suite.fixture.config),
  cacheDir: join(runDirectory, "vite-cache"),
  clearScreen: false,
  build: { outDir: join(runDirectory, "fixture-dist"), emptyOutDir: false },
  server: { host: "127.0.0.1", port, strictPort: true, open: false },
  preview: { host: "127.0.0.1", port, strictPort: true, open: false },
};
if (suite.fixture.mode === "dev") {
  server = await createServer(options);
  await server.listen();
} else {
  await build(options);
  server = await preview(options);
}
console.log(`Fixture ${suite.id}: http://127.0.0.1:${port}${suite.fixture.path}`);
