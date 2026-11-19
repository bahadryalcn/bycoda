import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runConversationMcp } from "../conversation/conversation-tools";
import { runSocialMcp } from "../social/social-tools";
import { McpStdioCallTracker, MCP_STDIO_MAX_IN_FLIGHT } from "./stdio-call-tracker";

type Reply = { id?: number | null; result?: any; error?: any };

function rig() {
  const input = new PassThrough();
  const output = new PassThrough();
  const replies: Reply[] = [];
  let pending = "";
  output.on("data", (chunk) => {
    pending += String(chunk);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line) replies.push(JSON.parse(line));
  });
  const send = (message: unknown) => input.write(JSON.stringify(message) + "\n");
  const reply = (id: number) => replies.find((item) => item.id === id);
  return { input, output, send, replies, reply };
}

const conversationCall = (id: number) => ({
  id,
  method: "tools/call",
  params: {
    name: "conversation_files_write",
    arguments: { path: `f${id}.txt`, expectedHash: "a".repeat(64), content: "x" },
  },
});
const socialCall = (id: number, requestId?: string) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "social_replies_send", arguments: { id: "draft-1", requestId } },
});

/** A call whose completion the test controls; rejects when its signal aborts. */
function gate() {
  const started: { release: () => void; signal?: AbortSignal }[] = [];
  const call = vi.fn(async (...args: unknown[]) => {
    const signal = args.at(-1) as AbortSignal;
    return await new Promise((resolve, reject) => {
      started.push({ release: () => resolve({ done: true }), signal });
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  return { call, started };
}

describe.each([
  ["Conversation", runConversationMcp, conversationCall],
  ["Social", runSocialMcp, (id: number) => socialCall(id)],
] as const)("%s MCP stdio concurrency", (_name, run, toolCall) => {
  it("answers ping and tools/list while a tool call is still running", async () => {
    const { input, output, send, reply } = rig();
    const { call, started } = gate();
    const running = run(input, output, call as never);
    send(toolCall(1));
    await vi.waitFor(() => expect(started).toHaveLength(1));
    send({ jsonrpc: "2.0", id: 2, method: "ping" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    await vi.waitFor(() => expect(reply(3)?.result.tools.length).toBeGreaterThan(0));
    expect(reply(2)?.result).toEqual({});
    expect(reply(1)).toBeUndefined();
    started[0].release();
    input.end();
    await running;
    expect(reply(1)?.result.isError).toBeUndefined();
  });

  it("starts a second call before the first one finishes", async () => {
    const { input, output, send, reply } = rig();
    const { call, started } = gate();
    const running = run(input, output, call as never);
    send(toolCall(1));
    send(toolCall(2));
    await vi.waitFor(() => expect(started).toHaveLength(2));
    started[1].release();
    await vi.waitFor(() => expect(reply(2)).toBeDefined());
    expect(reply(1)).toBeUndefined();
    started[0].release();
    input.end();
    await running;
    expect(reply(1)).toBeDefined();
  });

  it("aborts a cancelled call and sends it no response", async () => {
    const { input, output, send, replies } = rig();
    const { call, started } = gate();
    const running = run(input, output, call as never);
    send(toolCall(7));
    await vi.waitFor(() => expect(started).toHaveLength(1));
    send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } });
    await vi.waitFor(() => expect(started[0].signal?.aborted).toBe(true));
    input.end();
    await running;
    expect(replies.filter((item) => item.id === 7)).toEqual([]);
  });

  it("waits for in-flight calls when the input closes", async () => {
    const { input, output, send, reply } = rig();
    const { call, started } = gate();
    const running = run(input, output, call as never);
    send(toolCall(1));
    await vi.waitFor(() => expect(started).toHaveLength(1));
    input.end();
    let settled = false;
    void running.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    started[0].release();
    await running;
    expect(reply(1)).toBeDefined();
  });
});

describe("Social MCP stdio retries", () => {
  it("keeps calls that share a requestId in order", async () => {
    const { input, output, send, reply } = rig();
    const { call, started } = gate();
    const running = runSocialMcp(input, output, call as never);
    send(socialCall(1, "retry:draft-1"));
    send(socialCall(2, "retry:draft-1"));
    send(socialCall(3, "other"));
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(call).toHaveBeenCalledTimes(2);
    started[0].release();
    await vi.waitFor(() => expect(started).toHaveLength(3));
    for (const item of started.slice(1)) item.release();
    input.end();
    await running;
    expect([1, 2, 3].every((id) => reply(id)?.result.isError === undefined)).toBe(true);
  });
});

describe("McpStdioCallTracker", () => {
  it("refuses new work at the in-flight cap and frees a slot when a call settles", async () => {
    const tracker = new McpStdioCallTracker();
    const releases: (() => void)[] = [];
    for (let id = 0; id < MCP_STDIO_MAX_IN_FLIGHT; id++)
      tracker.start(id, () => new Promise<void>((resolve) => releases.push(resolve)));
    expect(tracker.full).toBe(true);
    // `start` runs the work on a microtask, so the release callbacks appear a tick later.
    await vi.waitFor(() => expect(releases).toHaveLength(MCP_STDIO_MAX_IN_FLIGHT));
    releases[0]();
    await vi.waitFor(() => expect(tracker.full).toBe(false));
    for (const release of releases) release();
    await tracker.drain();
  });

  it("does not leak an escaped rejection and still drains", async () => {
    const tracker = new McpStdioCallTracker();
    tracker.start(1, async () => {
      throw new Error("escaped");
    });
    await expect(tracker.drain()).resolves.toBeUndefined();
  });
});
