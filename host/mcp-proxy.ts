import type { Readable, Writable } from "node:stream";

export type McpScope = "conversation" | "runtime-logs" | "social";

// Code-owned read operations only. Unknown tools remain ordering barriers; never
// trust client-supplied readOnly annotations to classify a mutation.
const READ_TOOLS = new Set([
  "runtime_logs_read",
  "runtime_logs_sources",
  "social_accounts_list",
  "social_policy_get",
  ...[
    "tools_list",
    "resources_read",
    "logs_read",
    "logs_sources",
    "sessions_list",
    "sessions_read",
    "goals_list",
    "goals_get",
    "tasks_list",
    "tasks_get",
    "files_list",
    "files_index",
    "files_read",
    "files_search",
    "files_searchContent",
    "git_index",
    "git_fileDiff",
    "notes_list",
    "notes_read",
    "automations_list",
    "automations_get",
    "stewards_list",
    "stewards_get",
    "machines_list",
    "devices_list",
    "devices_status",
    "devServers_list",
    "devServers_details",
    "devServers_logs",
    "skills_search",
    "skills_read",
  ].map((name) => `conversation_${name}`),
]);
type Message = { id?: unknown; method?: string; params?: { name?: string } };
function independent(message: Message | null) {
  return (
    !!message &&
    ([
      "ping",
      "tools/list",
      "resources/list",
      "resources/read",
      "resources/templates/list",
      "prompts/list",
      "prompts/get",
    ].includes(message.method ?? "") ||
      (message.method === "tools/call" && READ_TOOLS.has(message.params?.name ?? "")))
  );
}

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
  const lifetime = new AbortController();
  const outputError = () => lifetime.abort();
  output.on("error", outputError);
  let outputTail = Promise.resolve();
  const emit = (value: unknown) => {
    const line = JSON.stringify(value) + "\n";
    const written = outputTail.then(
      () =>
        new Promise<void>((resolve, reject) => {
          output.write(line, (error) => (error ? reject(error) : resolve()));
        }),
    );
    // Keep whole JSON messages ordered and wait for writable completion. At most
    // four normal responses and one cancellation are admitted into this path.
    outputTail = written;
    return written;
  };
  let bufferedResponseBytes = 0;
  const forward = async (message: Message | null) => {
    let heldBytes = 0;
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(250_000)]),
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
        if (
          size + chunk.byteLength > 16 * maxBytes ||
          bufferedResponseBytes + chunk.byteLength > 16 * maxBytes
        )
          throw new Error();
        size += chunk.byteLength;
        heldBytes += chunk.byteLength;
        bufferedResponseBytes += chunk.byteLength;
        chunks.push(chunk);
      }
      // Only protocol responses reach stdout; never print HTTP diagnostics or credentials.
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (message && Object.hasOwn(message, "id")) await emit(result);
    } catch {
      if (message && Object.hasOwn(message, "id"))
        await emit({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: "MCP host request failed." },
        });
    } finally {
      bufferedResponseBytes -= heldBytes;
    }
  };
  const slots = (limit: number) => {
    let used = 0;
    const waiters: (() => void)[] = [];
    return {
      async take() {
        if (used < limit) used++;
        else await new Promise<void>((resolve) => waiters.push(resolve));
      },
      release() {
        const next = waiters.shift();
        if (next) next();
        else used--;
      },
    };
  };
  const normal = slots(4),
    control = slots(1);
  const pendingCalls = new Set<Promise<void>>();
  let queuedBytes = 0;
  let barrier = Promise.resolve();
  let failure: unknown;
  const enqueue = async (line: string) => {
    if (!line.trim()) return;
    const bytes = Buffer.byteLength(line);
    if (bytes > maxBytes) throw new Error("MCP request too large.");
    while (pendingCalls.size >= 32 || queuedBytes + bytes > 4 * maxBytes)
      await Promise.race(pendingCalls);
    let message: Message | null;
    try {
      message = JSON.parse(line);
    } catch {
      await emit({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const cancellation = message?.method === "notifications/cancelled";
    const read = independent(message);
    const before = cancellation ? Promise.resolve() : read ? barrier : Promise.all(pendingCalls);
    const pool = cancellation ? control : normal;
    queuedBytes += bytes;
    const job = (async () => {
      await before;
      await pool.take();
      try {
        await forward(message);
      } finally {
        pool.release();
      }
    })();
    if (!read && !cancellation) barrier = job;
    pendingCalls.add(job);
    const done = () => {
      pendingCalls.delete(job);
      queuedBytes -= bytes;
    };
    void job.then(done, (error) => {
      failure ??= error;
      lifetime.abort();
      done();
    });
  };
  input.setEncoding("utf8");
  let pending = "";
  try {
    for await (const chunk of input) {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        await enqueue(line);
      }
      if (Buffer.byteLength(pending) > maxBytes) throw new Error("MCP request too large.");
    }
    await enqueue(pending);
    await Promise.all(pendingCalls);
    if (failure) throw failure;
  } finally {
    lifetime.abort();
    await Promise.allSettled(pendingCalls);
    output.off("error", outputError);
  }
}
