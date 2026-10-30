import {
  processConstructions,
  type FixtureProcessOperation,
} from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostRunHandle } from "../../core/hostRun";
import type { HarnessEvent } from "../../core/types";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
let closedNormal: HostRunHandle | undefined;

beforeEach(() => {
  processConstructions.reset();
  killChild.mockReset().mockResolvedValue(undefined);
  resolveCursorBinary.mockReset().mockResolvedValue({ path: "/fake/cursor-agent" });
});
const killChild = vi.fn(async () => undefined);
const resolveCursorBinary = vi.fn(async () => ({ path: "/fake/cursor-agent" }));
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveCursorBinary,
    spawnChild: async () => undefined,
    killChild,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (value: string) => void) => {
      onLine = line;
    },
    writeChild: async (_id: string, line: string) => {
      const source = originalWriteRun(processConstructions.operations.at(-1));
      if (closedNormal && source === closedNormal)
        throw new Error("Normal fixture run admission closed");
      sent.push(line);
    },
  }),
);

const { runCursorTextPrompt, stopCursorTextPrompt, warmupCursorText } =
  await import("./cursorText");

/** Write.hostRun is the fixture's process-birth annotation. Resolve the actual
 * guarded writer to its exact original bind when testing writer admission. */
function originalWriteRun(entry: FixtureProcessOperation | undefined): HostRunHandle | undefined {
  if (!entry?.writer) return undefined;
  const original = processConstructions.originalWriter(entry.writer);
  return processConstructions.operations.find(
    (binding) =>
      binding.kind === "bind" && binding.handle === entry.handle && binding.writer === original,
  )?.hostRun;
}

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
  closedNormal = undefined;
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

async function openScopedText(sessionId: string) {
  await waitFor(() => !!outbound("initialize"), "scoped initialize");
  reply("initialize", {});
  await waitFor(() => !!outbound("authenticate"), "scoped authenticate");
  reply("authenticate", {});
  await waitFor(() => !!outbound("session/new"), "scoped session/new");
  reply("session/new", { sessionId, configOptions: [{ id: "model", category: "model" }] });
  await waitFor(() => !!outbound("session/set_mode"), "scoped mode");
  reply("session/set_mode", {});
  await waitFor(() => !!outbound("session/set_config_option"), "scoped model");
  reply("session/set_config_option", {});
}
function answerScopedText(text: string) {
  onLine?.(
    JSON.stringify({
      method: "session/update",
      params: {
        update: { sessionUpdate: "agent_message_chunk", content: text },
      },
    }),
  );
  reply("session/prompt", {});
}

it("retains each original naming scope across queueing and the preceding actual cleanup", async () => {
  // Actual text pool and ACP multiplexer; opaque scopes belong only to this
  // controlled protocol fixture. This is not a Host authority or OS IO claim.
  const sourceA = Object.freeze({}) as HostRunHandle;
  const sourceB = Object.freeze({}) as HostRunHandle;
  const controlA = Object.freeze({}) as HostRunHandle;
  const controlB = Object.freeze({}) as HostRunHandle;
  const contextA = { operation: {}, hostRun: sourceA, hostControlRun: controlA };
  const contextB = { operation: {}, hostRun: sourceB, hostControlRun: controlB };
  let release!: () => void;
  let entered = false;
  killChild.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        entered = true;
        release = resolve;
      }),
  );
  const a = runCursorTextPrompt({ cwd: "/repo", prompt: "A title", operationContext: contextA });
  void a.catch(() => undefined);
  contextA.hostRun = sourceB;
  contextA.hostControlRun = controlB;
  await openScopedText("A");
  await waitFor(() => !!outbound("session/prompt"), "A prompt");
  const original = processConstructions.created[0];
  const oldLine = onLine!;
  const b = runCursorTextPrompt({ cwd: "/repo", prompt: "B branch", operationContext: contextB });
  void b.catch(() => undefined);
  contextB.hostRun = sourceA;
  contextB.hostControlRun = controlA;
  try {
    answerScopedText("A answer");
    await waitFor(() => entered, "original A cleanup");
    expect(processConstructions.created).toEqual([original]);
    expect(
      processConstructions.operations
        .filter((entry) => entry.kind === "write")
        .every((entry) => entry.hostRun === sourceA),
    ).toBe(true);
    sent.length = 0;
    release();
    await expect(a).resolves.toBe("A answer");
    await openScopedText("B");
    await waitFor(() => !!outbound("session/prompt"), "B prompt");
    const replacement = processConstructions.created[1];
    expect(replacement).not.toBe(original);
    const bWrites = processConstructions.operations.filter(
      (entry) => entry.kind === "write" && entry.handle === replacement,
    );
    expect(bWrites.length).toBeGreaterThan(0);
    expect(bWrites.every((entry) => entry.hostRun === sourceB && entry.writer !== undefined)).toBe(
      true,
    );
    const before = sent.length;
    oldLine(JSON.stringify({ id: 700, method: "session/request_permission", params: {} }));
    await Promise.resolve();
    await Promise.resolve();
    expect(sent.length).toBe(before);
    answerScopedText("B answer");
    await expect(b).resolves.toBe("B answer");
    expect(
      processConstructions.operations
        .filter((entry) => entry.kind === "kill")
        .map((entry) => entry.handle),
    ).toEqual([original, replacement]);
  } finally {
    release?.();
    await stopCursorTextPrompt();
    await Promise.allSettled([a, b]);
  }
});

it("refuses adoption of an uncontrolled warm pool before protocol mutation and permits a fresh scoped job after explicit retirement", async () => {
  const warming = warmupCursorText("/repo");
  await openScopedText("warm");
  await warming;
  const original = processConstructions.created[0];
  sent.length = 0;
  const context = {
    operation: {},
    hostRun: Object.freeze({}) as HostRunHandle,
    hostControlRun: Object.freeze({}) as HostRunHandle,
  };
  await expect(
    runCursorTextPrompt({ cwd: "/repo", prompt: "Cannot adopt", operationContext: context }),
  ).rejects.toThrow("birth Host run");
  expect(processConstructions.created).toEqual([original]);
  expect(sent).toEqual([]);
  expect(killChild).not.toHaveBeenCalled();
  // Retirement is an explicit test owner action, never an automatic adoption workaround.
  await stopCursorTextPrompt();
  const fresh = runCursorTextPrompt({
    cwd: "/repo",
    prompt: "Fresh scoped",
    operationContext: {
      operation: {},
      hostRun: context.hostRun,
      hostControlRun: context.hostControlRun,
    },
  });
  void fresh.catch(() => undefined);
  await openScopedText("fresh");
  await waitFor(() => !!outbound("session/prompt"), "fresh scoped prompt");
  answerScopedText("fresh answer");
  await expect(fresh).resolves.toBe("fresh answer");
});

it("uses only original cleanup admission for cancellation after normal naming writes close", async () => {
  // Controlled process protocol fixture, not the real Host issuer or OS.
  const normal = Object.freeze({}) as HostRunHandle;
  const control = Object.freeze({}) as HostRunHandle;
  const context = { operation: {}, hostRun: normal, hostControlRun: control };
  const controller = new AbortController();
  const work = runCursorTextPrompt({
    cwd: "/repo",
    prompt: "Cancel original",
    signal: controller.signal,
    operationContext: context,
  });
  const failure = work.then(
    () => undefined,
    (error: unknown) => error,
  );
  await openScopedText("original_provider_session");
  await waitFor(() => !!outbound("session/prompt"), "original scoped prompt");
  const original = processConstructions.created[0];
  closedNormal = normal;
  // Mutation after capture must not retarget either role to an unrelated source.
  context.hostControlRun = Object.freeze({}) as HostRunHandle;
  controller.abort();
  expect(await failure).toEqual(
    expect.objectContaining({ message: "By-the-way request cancelled" }),
  );
  const cancels = processConstructions.operations.filter(
    (entry) =>
      entry.kind === "write" && JSON.parse(String(entry.args[0])).method === "session/cancel",
  );
  expect(cancels.length).toBeGreaterThan(0);
  expect(messages().filter((message) => message.method === "session/cancel")).toHaveLength(
    cancels.length,
  );
  expect(
    cancels.every(
      (entry) =>
        entry.handle === original &&
        originalWriteRun(entry) === control &&
        entry.writer !== undefined,
    ),
  ).toBe(true);
  expect(
    cancels.every(
      (entry) => JSON.parse(String(entry.args[0])).params.sessionId === "original_provider_session",
    ),
  ).toBe(true);
  expect(processConstructions.created).toEqual([original]);
});
it("refuses a Host naming source without its original cleanup pair before process effects", async () => {
  await expect(
    runCursorTextPrompt({
      cwd: "/repo",
      prompt: "No cleanup grant",
      operationContext: { operation: {}, hostRun: Object.freeze({}) as HostRunHandle },
    }),
  ).rejects.toThrow("cleanup run is required");
  expect(processConstructions.created).toEqual([]);
  expect(resolveCursorBinary).not.toHaveBeenCalled();
  expect(sent).toEqual([]);
});
