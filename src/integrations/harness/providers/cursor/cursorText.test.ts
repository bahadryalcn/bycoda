import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

beforeEach(() => {
  processConstructions.reset();
  resolveCursorBinary.mockReset().mockResolvedValue({ path: "/fake/cursor-agent" });
});
const resolveCursorBinary = vi.fn(async () => ({ path: "/fake/cursor-agent" }));
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveCursorBinary,
    spawnChild: async () => undefined,
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (value: string) => void) => {
      onLine = line;
    },
    writeChild: async (_id: string, line: string) => {
      sent.push(line);
    },
  }),
);

const { runCursorTextPrompt, stopCursorTextPrompt, warmupCursorText } =
  await import("./cursorText");

function messages() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function outbound(method: string) {
  return messages().find((message) => message.method === method);
}

function reply(method: string, result: unknown) {
  const request = outbound(method);
  onLine?.(JSON.stringify({ jsonrpc: "2.0", id: request?.id, result }));
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
});

afterEach(async () => {
  await stopCursorTextPrompt();
});

it("does not auto-start a replacement when Stop rejects a reused A session setup", async () => {
  // Actual ACP/JSON-RPC clients, protocol process fake; this is not Native IPC proof.
  const open = async (sessionId: string) => {
    await waitFor(() => !!outbound("initialize"), `${sessionId} initialize`);
    reply("initialize", {});
    await waitFor(() => !!outbound("authenticate"), `${sessionId} authenticate`);
    reply("authenticate", {});
    await waitFor(() => !!outbound("session/new"), `${sessionId} session/new`);
    reply("session/new", { sessionId, configOptions: [{ id: "model", category: "model" }] });
    await waitFor(() => !!outbound("session/set_mode"), `${sessionId} mode`);
    reply("session/set_mode", {});
    await waitFor(() => !!outbound("session/set_config_option"), `${sessionId} model`);
    reply("session/set_config_option", {});
  };
  const warming = warmupCursorText("/repo-A");
  await open("cursor-A");
  await warming;
  const original = processConstructions.created[0];
  expect(original).toBeDefined();
  expect(
    processConstructions.operations
      .filter((operation) => operation.kind === "spawn")
      .map((operation) => operation.handle),
  ).toEqual([original]);
  sent.length = 0;
  let settled = false;
  const reuse = runCursorTextPrompt({
    cwd: "/repo-B",
    model: "different-model",
    prompt: "Do not restart after Stop",
  }).then(
    (value) => {
      settled = true;
      return { value, error: undefined };
    },
    (error: unknown) => {
      settled = true;
      return { value: undefined, error };
    },
  );
  try {
    await waitFor(() => !!outbound("session/new"), "reused A session/new pending");
    const pending = outbound("session/new")!;
    const originalLine = onLine!;
    expect(pending.params).toMatchObject({ cwd: "/repo-B" });
    expect(settled).toBe(false);
    expect(processConstructions.created).toEqual([original]);
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "write").at(-1)
        ?.handle,
    ).toBe(original);
    await stopCursorTextPrompt();
    await vi.waitFor(() => expect(settled).toBe(true));
    expect((await reuse).error).toBeInstanceOf(Error);
    // The stale rejection must not enter ensureLive's ordinary retry ladder.
    expect(processConstructions.created).toEqual([original]);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "spawn")
        .map((operation) => operation.handle),
    ).toEqual([original]);
    expect(sent.some((line) => JSON.parse(line).method === "initialize")).toBe(false);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "kill")
        .map((operation) => operation.handle),
    ).toEqual([original]);
    originalLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: pending.id,
        error: { code: -32000, message: "late A setup rejection" },
      }),
    );
    sent.length = 0;
    const fresh = runCursorTextPrompt({ cwd: "/repo-C", prompt: "Explicit fresh start" });
    void fresh.catch(() => undefined);
    await open("cursor-C");
    await waitFor(() => !!outbound("session/prompt"), "explicit C prompt");
    const replacement = processConstructions.created[1];
    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(original);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "spawn")
        .map((operation) => operation.handle),
    ).toEqual([original, replacement]);
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "write").at(-1)
        ?.handle,
    ).toBe(replacement);
    onLine?.(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "cursor-C",
          update: { sessionUpdate: "agent_message_chunk", content: "Fresh C answer" },
        },
      }),
    );
    reply("session/prompt", {});
    await expect(fresh).resolves.toBe("Fresh C answer");
    expect(processConstructions.created).toHaveLength(2);
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "kill").at(-1)
        ?.handle,
    ).toBe(replacement);
  } finally {
    await stopCursorTextPrompt();
  }
});

it("retires binary-held A without dispatch and starts B on a distinct original handle", async () => {
  let release!: (value: { path: string }) => void;
  resolveCursorBinary.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = runCursorTextPrompt({ cwd: "/repo", prompt: "Never dispatch A" }).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await vi.waitFor(() => expect(resolveCursorBinary).toHaveBeenCalledOnce());
    const original = processConstructions.created[0];
    expect(original).toBeDefined();
    await stopCursorTextPrompt();
    expect(sent).toEqual([]);
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "spawn"),
    ).toEqual([]);
    const second = runCursorTextPrompt({ cwd: "/repo", prompt: "Dispatch B" });
    void second.catch(() => undefined);
    release({ path: "/late/cursor-A" });
    expect(await first).toEqual(
      expect.objectContaining({ message: expect.stringContaining("startup cancelled") }),
    );
    await waitFor(() => !!outbound("initialize"), "B initialize");
    reply("initialize", {});
    await waitFor(() => !!outbound("authenticate"), "B authenticate");
    reply("authenticate", {});
    await waitFor(() => !!outbound("session/new"), "B session/new");
    reply("session/new", {
      sessionId: "cursor-B",
      configOptions: [{ id: "model", category: "model" }],
    });
    await waitFor(() => !!outbound("session/set_mode"), "B mode");
    reply("session/set_mode", {});
    await waitFor(() => !!outbound("session/set_config_option"), "B model");
    reply("session/set_config_option", {});
    await waitFor(() => !!outbound("session/prompt"), "B prompt");
    const replacement = processConstructions.created[1];
    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(original);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "spawn")
        .map((operation) => operation.handle),
    ).toEqual([replacement]);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "write")
        .every((operation) => operation.handle === replacement),
    ).toBe(true);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "kill")
        .every((operation) => operation.handle === original),
    ).toBe(true);
    onLine?.(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "cursor-B",
          update: { sessionUpdate: "agent_message_chunk", content: "B answer" },
        },
      }),
    );
    reply("session/prompt", {});
    await expect(second).resolves.toBe("B answer");
  } finally {
    release?.({ path: "/late/cursor-A" });
    await stopCursorTextPrompt();
  }
});

it("forwards Cursor text deltas without duplicating snapshots", async () => {
  const events: HarnessEvent[] = [];
  const result = runCursorTextPrompt({
    cwd: "/repo",
    prompt: "question",
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => !!outbound("initialize"), "initialize");
  reply("initialize", {});
  await waitFor(() => !!outbound("authenticate"), "authenticate");
  reply("authenticate", {});
  await waitFor(() => !!outbound("session/new"), "session/new");
  reply("session/new", {
    sessionId: "cursor_text",
    configOptions: [{ id: "model", category: "model" }],
  });
  await waitFor(() => !!outbound("session/set_mode"), "session/set_mode");
  reply("session/set_mode", {});
  await waitFor(() => !!outbound("session/set_config_option"), "session/set_config_option");
  reply("session/set_config_option", {});
  await waitFor(() => !!outbound("session/prompt"), "session/prompt");

  onLine?.(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "cursor_text",
        update: { sessionUpdate: "agent_message_chunk", content: "Hel" },
      },
    }),
  );
  onLine?.(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "cursor_text",
        update: { sessionUpdate: "agent_message", content: "Hello" },
      },
    }),
  );
  reply("session/prompt", {});

  await expect(result).resolves.toBe("Hello");
  expect(events).toEqual([
    { type: "message.delta", text: "Hel" },
    { type: "message.delta", text: "lo" },
  ]);
});
