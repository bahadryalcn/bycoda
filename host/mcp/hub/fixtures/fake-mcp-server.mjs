// Test-only stdio MCP server. Each start appends its pid to FAKE_MCP_START_LOG.
// A tools/call named "crash" exits the process to simulate a crashed server.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.env.FAKE_MCP_START_LOG)
  appendFileSync(process.env.FAKE_MCP_START_LOG, `${process.pid}\n`);

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: "fake", version: "1" },
      });
    case "tools/list":
      return reply({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    case "prompts/list":
      return reply({ prompts: [] });
    case "tools/call":
      if (message.params.name === "crash") process.exit(3);
      return reply({
        content: [{ type: "text", text: `${message.params.arguments?.text ?? ""}:${process.pid}` }],
      });
    default:
      return send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Unsupported" },
      });
  }
});
