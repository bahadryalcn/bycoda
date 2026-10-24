import { expect, it, vi } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { runMcpProxy } from "./mcp-proxy";

const env = { BYCODA_MCP_TOKEN: "test-only", BYCODA_MCP_ENDPOINT: "http://127.0.0.1:1234" };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const call = (id: number, name = "conversation_sessions_list") =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } }) +
  "\n";
function sink() {
  const messages: { id: number; error?: unknown }[] = [];
  return {
    messages,
    output: new Writable({
      write(chunk, _encoding, done) {
        messages.push(JSON.parse(String(chunk)));
        done();
      },
    }),
  };
}

it("admits an independent read and cancellation while a slow read is still running", async () => {
  const first = gate(),
    input = new PassThrough(),
    result = sink();
  const started: (number | string)[] = [];
  const fetcher = vi.fn(async (_url, options) => {
    const message = JSON.parse(String(options?.body));
    started.push(message.id ?? message.method);
    if (message.id === 1) await first.promise;
    return message.id === undefined
      ? new Response(null, { status: 202 })
      : Response.json({ id: message.id, result: {} });
  }) as unknown as typeof fetch;
  const running = runMcpProxy("conversation", input, result.output, env, fetcher);
  input.write(call(1));
  await turn();
  input.end(
    call(2) +
      JSON.stringify({ method: "notifications/cancelled", params: { requestId: 1 } }) +
      "\n",
  );
  try {
    await turn();
    expect(started).toContain(2);
    expect(started).toContain("notifications/cancelled");
    expect(result.messages.map((message) => message.id)).toEqual([2]);
  } finally {
    first.release();
    await running;
  }
  expect(result.messages.map((message) => message.id).sort()).toEqual([1, 2]);
});

it("keeps initialization and unknown mutations as barriers for later reads", async () => {
  const initialize = gate(),
    mutation = gate(),
    input = new PassThrough(),
    result = sink();
  const started: number[] = [];
  const fetcher = vi.fn(async (_url, options) => {
    const message = JSON.parse(String(options?.body));
    started.push(message.id);
    if (message.id === 1) await initialize.promise;
    if (message.id === 3) await mutation.promise;
    return Response.json({ id: message.id, result: {} });
  }) as unknown as typeof fetch;
  const running = runMcpProxy("conversation", input, result.output, env, fetcher);
  input.end(
    JSON.stringify({ id: 1, method: "initialize" }) +
      "\n" +
      call(2) +
      call(3, "unknown_mutation") +
      call(4),
  );
  try {
    await turn();
    expect(started).toEqual([1]);
    initialize.release();
    await turn();
    expect(started).toEqual([1, 2, 3]);
    mutation.release();
    await running;
    expect(started).toEqual([1, 2, 3, 4]);
  } finally {
    initialize.release();
    mutation.release();
    await running;
  }
});

it("bounds admission while stdout is backpressured and drains every queued response at EOF", async () => {
  const blocked = gate(),
    input = new PassThrough();
  const ids: number[] = [];
  let writes = 0;
  const output = new Writable({
    write(chunk, _encoding, done) {
      ids.push(JSON.parse(String(chunk)).id);
      if (writes++ === 0) void blocked.promise.then(() => done());
      else done();
    },
  });
  const fetcher = vi.fn(async (_url, options) =>
    Response.json({ id: JSON.parse(String(options?.body)).id, result: {} }),
  ) as unknown as typeof fetch;
  const running = runMcpProxy("conversation", input, output, env, fetcher);
  input.end(Array.from({ length: 100 }, (_, index) => call(index)).join(""));
  try {
    await turn();
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4);
    blocked.release();
    await running;
    expect(new Set(ids).size).toBe(100);
  } finally {
    blocked.release();
    await running;
  }
});
