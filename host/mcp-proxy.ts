import type { Readable, Writable } from "node:stream";

export type McpScope = "conversation" | "runtime-logs" | "social";

/** Transport only: schemas, dispatch and authorization belong to the host. */
export async function runMcpProxy(
  scope: McpScope,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const prefix = `BYCODA_${scope.replaceAll("-", "_").toUpperCase()}`;
  const token = env[`${prefix}_TOKEN`] || env.BYCODA_MCP_TOKEN;
  const address = env[`${prefix}_ENDPOINT`] || env.BYCODA_MCP_ENDPOINT;
  if (!token || !address) throw new Error("MCP endpoint and environment credential required.");
  let endpoint: URL;
  try {
    endpoint = new URL(address);
    if (
      (endpoint.protocol !== "https:" &&
        !(endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1")) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !["/", "/mcp", `/mcp/${scope}`].includes(endpoint.pathname)
    )
      throw new Error();
    endpoint.pathname = `/mcp/${scope}`;
  } catch {
    throw new Error("MCP requires HTTPS or a local IPv4 loopback host endpoint.");
  }
  const maxBytes = 1024 * 1024;
  const forward = async (line: string) => {
    if (!line.trim()) return;
    let message: { id?: unknown };
    try {
      message = JSON.parse(line);
    } catch {
      output.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n",
      );
      return;
    }
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(250_000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      if (response.status === 202 || !response.body) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 16 * maxBytes) throw new Error();
        chunks.push(chunk);
      }
      // Only protocol responses reach stdout; never print HTTP diagnostics or credentials.
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (message && Object.hasOwn(message, "id")) output.write(JSON.stringify(result) + "\n");
    } catch {
      if (message && Object.hasOwn(message, "id"))
        output.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: "MCP host request failed." },
          }) + "\n",
        );
    }
  };
  input.setEncoding("utf8");
  let pending = "";
  for await (const chunk of input) {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      if (Buffer.byteLength(line) > maxBytes) throw new Error("MCP request too large.");
      pending = pending.slice(newline + 1);
      await forward(line);
    }
    if (Buffer.byteLength(pending) > maxBytes) throw new Error("MCP request too large.");
  }
  await forward(pending);
}
