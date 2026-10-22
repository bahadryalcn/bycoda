// Packaged as host.mjs beside the full bycoda-host.mjs bundle. Keep provider
// helpers and the full host in the same directory so their relative paths hold.
import { delimiter, dirname } from "node:path";

const command = process.argv[2];

async function entry() {
  process.umask(0o077);
  if (["conversation-mcp", "runtime-logs-mcp", "social-mcp"].includes(command))
    process.env.PATH = [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter);
  if (command === "conversation-mcp") {
    const { runMcpProxy } = await import("./mcp-proxy");
    await runMcpProxy("conversation");
  } else if (command === "runtime-logs-mcp") {
    const { runMcpProxy } = await import("./mcp-proxy");
    await runMcpProxy("runtime-logs");
  } else if (command === "social-mcp") {
    const { runMcpProxy } = await import("./mcp-proxy");
    await runMcpProxy("social");
  } else {
    // A variable keeps esbuild from folding the full host into this light entry.
    const hostEntry = "./bycoda-host.mjs";
    await import(hostEntry);
  }
}

entry().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
