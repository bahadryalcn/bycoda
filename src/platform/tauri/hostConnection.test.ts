import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createTauriHostConnection, NativeHostConnectionError } from "./hostConnection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
});

it("converts an explicit legacy name before native dispatch without changing wire grammar", async () => {
  vi.mocked(invoke).mockResolvedValue({ generation: 4, result: null });
  const connection = createTauriHostConnection("machine");
  await connection.request(
    "goals.final-review.recheck",
    { goalId: "goal", expectedUpdatedAt: 1 },
    { requestId: "request.alias" },
  );
  expect(invoke).toHaveBeenCalledExactlyOnceWith(
    "host_connection_request",
    expect.objectContaining({
      method: "goals.finalReview.recheck",
      params: { goalId: "goal", expectedUpdatedAt: 1 },
    }),
  );
});
it.each(["goals.final--review.recheck", "goals.finalReview.unknown", "constructor"])(
  "does not enable unknown alias %s",
  async (method) => {
    await expect(
      createTauriHostConnection("machine").request(
        method,
        { goalId: "goal", expectedUpdatedAt: 1 },
        { requestId: "request.unknown" },
      ),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("uses credential-free native attachment and logical request fields", async () => {
  const connection = createTauriHostConnection("machine", { allowConnect: false });
  vi.mocked(invoke)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce({ generation: 4, result: null });
  expect(await connection.attach()).toBe(true);
  expect(
    await connection.request(
      "commands.status",
      { commandId: "c" },
      { requestId: "request", responseTimeoutMs: 12000 },
    ),
  ).toEqual({ generation: 4, result: null });
  expect(invoke).toHaveBeenNthCalledWith(1, "host_connection_attach", {
    machineId: "machine",
    allowConnect: false,
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "host_connection_request", {
    machineId: "machine",
    method: "commands.status",
    params: { commandId: "c" },
    requestId: "request",
    responseTimeoutMs: 12000,
    allowConnect: false,
  });
  expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toMatch(
    /bearer|authorization|credential|token/i,
  );
});

it("filters other machines and malformed native events and releases listening once", async () => {
  let emit!: (payload: unknown) => void;
  const unlisten = vi.fn();
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    emit = (payload) => callback({ event: "host-connection-event", id: 1, payload } as never);
    return unlisten;
  });
  const listener = vi.fn();
  const release = await createTauriHostConnection("machine").listen(listener);
  const state = {
    kind: "state",
    environmentId: "env",
    generation: 1,
    phase: "ready",
    category: null,
  };
  emit({ machineId: "other", event: state });
  emit({ machineId: "machine", event: { ...state, generation: -1 } });
  emit({ machineId: "machine", event: { ...state, phase: "invented" } });
  emit({ machineId: "machine", event: { ...state, bearer: "unexpected" } });
  emit({ machineId: "machine", event: state });
  expect(listener).toHaveBeenCalledExactlyOnceWith(state);
  release();
  release();
  expect(unlisten).toHaveBeenCalledOnce();
});

it("validates canonical subscription envelopes before forwarding", async () => {
  let emit!: (payload: unknown) => void;
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    emit = (payload) => callback({ payload } as never);
    return vi.fn();
  });
  const listener = vi.fn();
  const release = await createTauriHostConnection("machine").listen(listener);
  const envelope = {
    machineId: "machine",
    event: {
      kind: "subscription",
      environmentId: "env",
      generation: 1,
      event: {
        jsonrpc: "2.0",
        method: "subscription.event",
        params: {
          subscriptionId: "s",
          streamId: "stream",
          cursor: { epoch: "epoch", sequence: 1 },
          kind: "snapshot",
          data: { value: 1 },
        },
      },
    },
  };
  emit(envelope);
  emit({ ...envelope, event: { ...envelope.event, event: { method: "subscription.event" } } });
  expect(listener).toHaveBeenCalledExactlyOnceWith(envelope.event);
  release();
});

it("rejects unsupported methods and invalid command metadata before IPC", async () => {
  const connection = createTauriHostConnection("machine");
  await expect(connection.request("invented.write", {}, { requestId: "r" })).rejects.toThrow(
    "Unsupported",
  );
  await expect(
    connection.request(
      "commands.dispatch",
      { type: "send", commandId: "c", sessionId: "s", text: "hi", extra: true },
      { requestId: "r" },
    ),
  ).rejects.toThrow();
  await expect(
    connection.request("commands.status", { commandId: "c" }, { requestId: "bad request" }),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("validates native replies and protected bulk descriptors, and exposes cancel/detach", async () => {
  const connection = createTauriHostConnection("machine");
  vi.mocked(invoke).mockResolvedValueOnce({ generation: "old", result: null });
  await expect(
    connection.request("commands.status", { commandId: "c" }, { requestId: "r" }),
  ).rejects.toThrow();
  await expect(connection.bulk({ kind: "bulk" } as never)).rejects.toThrow();
  const descriptor = {
    kind: "bulk" as const,
    transferId: "t",
    environmentId: "env",
    totalBytes: 2,
    chunkBytes: 2,
    sha256: "a".repeat(64),
    expiresAt: 100,
  };
  vi.mocked(invoke).mockResolvedValueOnce({ data: 1 }).mockResolvedValue(undefined);
  expect(await connection.bulk(descriptor, { responseTimeoutMs: 15000 })).toEqual({ data: 1 });
  await connection.cancel("r");
  await connection.detach();
  expect(invoke).toHaveBeenCalledWith("host_connection_bulk", {
    machineId: "machine",
    descriptor,
    responseTimeoutMs: 15000,
  });
  expect(invoke).toHaveBeenCalledWith("host_connection_cancel", {
    machineId: "machine",
    requestId: "r",
  });
  expect(invoke).toHaveBeenCalledWith("host_connection_detach", { machineId: "machine" });
});

it("normalizes structured authentication failures into useful Errors without losing native metadata", async () => {
  const connection = createTauriHostConnection("machine");
  vi.mocked(invoke).mockRejectedValue({
    code: "RPC_WS_BLOCKED",
    message: "Device authorization was revoked.",
    generation: 7,
    requestId: "r",
    commandId: "c",
    uncertain: false,
    unsupported: false,
  });
  const error = await connection
    .request(
      "commands.dispatch",
      { type: "send", commandId: "c", sessionId: "s", text: "hi" },
      { requestId: "r", commandId: "c" },
    )
    .catch((error) => error);
  expect(error).toBeInstanceOf(NativeHostConnectionError);
  expect(error).toMatchObject({
    code: "RPC_WS_BLOCKED",
    generation: 7,
    requestId: "r",
    commandId: "c",
    uncertain: false,
    unsupported: false,
  });
  expect(error.message).toBe("RPC_WS_BLOCKED: Device authorization was revoked.");
  expect(String(error)).not.toContain("[object Object]");
});

it("does not trust malformed native failure metadata or an altered durable command identity", async () => {
  const connection = createTauriHostConnection("machine");
  const command = { type: "send", commandId: "original", sessionId: "s", text: "once" };
  for (const failure of [
    {
      code: "RPC_WS_BLOCKED",
      message: "private malformed payload",
      generation: -1,
      requestId: "r",
      commandId: "original",
      uncertain: false,
      unsupported: false,
    },
    {
      code: "RPC_WS_REMOTE",
      message: "private altered payload",
      generation: 1,
      requestId: "r",
      commandId: "different",
      uncertain: true,
      unsupported: false,
    },
    {
      code: "RPC_WS_UNSUPPORTED",
      message: "private unsafe fallback",
      generation: 1,
      requestId: "r",
      commandId: "original",
      uncertain: true,
      unsupported: true,
    },
  ]) {
    vi.mocked(invoke).mockRejectedValueOnce(failure);
    const error = await connection
      .request("commands.dispatch", command, { requestId: "r" })
      .catch((error) => error);
    expect(error).toMatchObject({
      code: "RPC_WS_SCHEMA",
      commandId: "original",
      uncertain: true,
      unsupported: false,
    });
    expect(error.message).not.toContain("private");
  }
});
it.each([
  ["goals.list", {}],
  ["tasks.save", { task: { id: "task" } }],
  ["files.write", { projectId: "p", path: "file", expected: "before", content: "after" }],
  ["devServers.bridgeRead", { projectId: "p", streamId: "bridge" }],
] as const)(
  "keeps unvalidated native %s failures uncertain without inventing a command receipt",
  async (method, params) => {
    vi.mocked(invoke).mockRejectedValue(new Error("Unvalidated private IPC error"));
    const error = await createTauriHostConnection("machine")
      .request(method, params, { requestId: "request" })
      .catch((error) => error);
    expect(error).toBeInstanceOf(NativeHostConnectionError);
    expect(error).toMatchObject({
      code: "RPC_WS_SCHEMA",
      commandId: null,
      uncertain: true,
      unsupported: false,
    });
    expect(error.message).not.toContain("private");
    expect(invoke).toHaveBeenCalledOnce();
  },
);
it.each([
  ["projects.list", {}],
  ["subscriptions.open", { subscriptionId: "s", target: { kind: "environment" } }],
  ["connection.probe", {}],
  ["requests.cancel", { requestId: "other" }],
] as const)(
  "does not mark unvalidated query/subscription/core-control %s failures as provider uncertainty",
  async (method, params) => {
    vi.mocked(invoke).mockRejectedValue(new Error("Unvalidated IPC error"));
    const error = await createTauriHostConnection("machine")
      .request(method, params, { requestId: "request" })
      .catch((error) => error);
    expect(error).toMatchObject({
      code: "RPC_WS_SCHEMA",
      commandId: null,
      uncertain: false,
      unsupported: false,
    });
    expect(invoke).toHaveBeenCalledOnce();
  },
);
it.each(["RPC_WS_BLOCKED", "RPC_WS_UNSUPPORTED"])(
  "preserves validated stateful pre-admission %s evidence",
  async (code) => {
    vi.mocked(invoke).mockRejectedValue({
      code,
      message: "Before admission",
      generation: null,
      requestId: null,
      commandId: null,
      uncertain: false,
      unsupported: code === "RPC_WS_UNSUPPORTED",
    });
    const error = await createTauriHostConnection("machine")
      .request("goals.list", {}, { requestId: "request" })
      .catch((error) => error);
    expect(error).toMatchObject({
      code,
      uncertain: false,
      commandId: null,
      unsupported: code === "RPC_WS_UNSUPPORTED",
    });
  },
);
