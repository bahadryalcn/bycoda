/** In-memory Vite TS transform only; no app/Host build, listener, provider or tool calls. */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--context-only"))
  throw new Error("Usage: node evals/run.mjs [--context-only]");
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  clearScreen: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
});
try {
  const { createOfflineReport } = await server.ssrLoadModule("/evals/report.ts");
  const report = createOfflineReport();
  console.log(JSON.stringify(args.includes("--context-only") ? report.context : report, null, 2));
} finally {
  await server.close();
}
