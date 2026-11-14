// Test-only stdio MCP server with tool annotations, instructions, a hanging tool and a big result.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.env.FAKE_MCP_START_LOG)
  appendFileSync(process.env.FAKE_MCP_START_LOG, `${process.pid}\n`);

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const tools = [
  {
    name: "look",
    description: "Reads",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  },
  { name: "mutate", description: "Writes", inputSchema: { type: "object" } },
  {
    name: "risky",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: true },
  },
  { name: "hang", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
  { name: "big", inputSchema: { type: "object", description: "x".repeat(20000) } },
];
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "annotated", version: "1" },
        instructions: "Annotated test server.\nSecond line.",
      });
    case "tools/list":
      return reply({ tools });
    case "tools/call":
      if (message.params.name === "hang") return;
      if (message.params.name === "big")
        return reply({
          content: [
            { type: "text", text: "y".repeat(40000) },
            { type: "image", data: "", mimeType: "image/png" },
          ],
        });
      return reply({ content: [{ type: "text", text: `ok:${process.pid}` }] });
    default:
      return send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Unsupported" },
      });
  }
});
