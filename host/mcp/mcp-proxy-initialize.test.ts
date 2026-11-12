import { expect, it, vi } from "vitest";
import { Readable, Writable } from "node:stream";
import { runMcpProxy } from "./mcp-proxy";

const env = { BYCODA_MCP_TOKEN: "test-only", BYCODA_MCP_ENDPOINT: "http://127.0.0.1:1234" };
async function initialize(fetcher: typeof fetch) {
  const replies: unknown[] = [];
  await runMcpProxy(
    "conversation",
    Readable.from(['{"jsonrpc":"2.0","id":7,"method":"initialize"}\n']),
    new Writable({
      write(chunk, _encoding, done) {
        replies.push(JSON.parse(String(chunk)));
        done();
      },
    }),
    env,
    fetcher,
  );
  return replies;
}

it.each([202, 204, 401, 502])("answers initialize explicitly for HTTP %s", async (status) => {
  const replies = await initialize(
    vi.fn(async () => new Response(null, { status })) as typeof fetch,
  );
  expect(replies).toEqual([
    {
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32603, message: `MCP host request failed (HTTP ${status}).` },
    },
  ]);
});

it("bounds initialize independently of long tool calls", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(20));
  try {
    const replies = await initialize(
      vi.fn(async (_url, options) => {
        await new Promise((_resolve, reject) =>
          options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), {
            once: true,
          }),
        );
        return Response.json({});
      }) as typeof fetch,
    );
    expect(spy).toHaveBeenCalledWith(5_000);
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 7, error: { code: -32603, message: "MCP initialize timed out." } },
    ]);
  } finally {
    spy.mockRestore();
  }
});
