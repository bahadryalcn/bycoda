import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (event: { payload: never }) => void>(),
  social: vi.fn(),
  logs: vi.fn(),
  conversation: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: never }) => void) => {
    mocks.handlers.set(name, handler);
    return () => {
      if (mocks.handlers.get(name) === handler) mocks.handlers.delete(name);
    };
  },
}));
vi.mock("./socialBridge", () => ({
  socialBridge: mocks.social,
  socialSpawnArgs: (_provider: unknown, args: string[]) => args,
  socialAcpServers: () => [],
}));
vi.mock("./runtimeLogsBridge", () => ({
  runtimeLogsBridge: mocks.logs,
  runtimeLogsSpawnArgs: (_provider: unknown, args: string[]) => args,
  runtimeLogsAcpServers: () => [],
}));
vi.mock("./conversationToolsBridge", () => ({
  conversationToolsBridge: mocks.conversation,
  conversationToolsSpawnArgs: (_provider: unknown, args: string[]) => args,
  conversationToolsAcpServers: () => [],
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function receipt(sessionId: string, construction: number) {
  return {
    version: 1 as const,
    backend: "native" as const,
    sessionId,
    pid: 42,
    constructionId: `00000000-0000-4000-8000-${construction.toString(16).padStart(12, "0")}`,
  };
}
type OutputApi = typeof import("./nativeOutputDelivery");
function nativeMetadata(
  api: OutputApi,
  source: ReturnType<typeof receipt>,
  line: string,
  sequence = 1,
) {
  return {
    version: 1 as const,
    qualified: false as const,
    processEpoch: "12121212-1212-4121-8121-121212121212",
    streamEpoch: source.constructionId,
    streamKind: "process" as const,
    sessionId: source.sessionId,
    sourceStoreId: "fixture-store",
    sourceProfileId: "fixture-profile",
    storeInstance: "23232323-2323-4232-8232-232323232323",
    processId: source.pid,
    ownerEpoch: "34343434-3434-4343-8343-343434343434",
    sequence,
    channel: "stdout" as const,
    itemCount: 1,
    utf8Bytes: Buffer.byteLength(line),
    payloadSha256: createHash("sha256")
      .update(api.frameNativeOutputItems("stdout", [line]))
      .digest("hex"),
    digestEncoding: "bycoda-output-items-le/v1" as const,
    available: true,
    unavailableReason: null,
  };
}
function emitNative(
  api: OutputApi,
  source: ReturnType<typeof receipt>,
  line: string,
  sequence = 1,
) {
  mocks.handlers.get("harness-stdout")?.({
    payload: {
      sessionId: source.sessionId,
      constructionId: source.constructionId,
      line,
      nativeOutput: nativeMetadata(api, source, line, sequence),
    } as never,
  });
}
async function fixture() {
  vi.resetModules();
  for (const bridge of [mocks.social, mocks.logs, mocks.conversation])
    bridge.mockReset().mockResolvedValue(null);
  let construction = 0;
  mocks.invoke
    .mockReset()
    .mockImplementation(async (command, args) =>
      command === "harness_spawn" ? receipt(args.sessionId, ++construction) : undefined,
    );
  const child = await import("./child");
  const { JsonRpcClient } = await import("./jsonRpc");
  const { AcpClient } = await import("./acp");
  return { child, JsonRpcClient, AcpClient };
}
afterEach(() => {
  mocks.handlers.clear();
  vi.useRealTimers();
});

it("keeps the actual ACP construction across delayed MCP preparation instead of writing to a replacement", async () => {
  const { child, AcpClient } = await fixture();
  const original = child.createChildProcessHandle("shared#0");
  const acp = new AcpClient(original, {});
  await child.spawnChild(original, "agent", [], "/fixture");
  const bridge = deferred<null>();
  mocks.social.mockReturnValueOnce(bridge.promise);
  const old = acp.request("session/new", { mcpServers: [] }).catch((error: Error) => error);
  expect(mocks.social).toHaveBeenCalledWith("shared");
  const replacement = child.createChildProcessHandle("shared#0");
  await child.spawnChild(replacement, "agent", [], "/fixture");
  bridge.resolve(null);
  expect(await old).toEqual(
    expect.objectContaining({ message: expect.stringContaining("retired") }),
  );
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "harness_write")).toHaveLength(
    0,
  );
  expect(child.captureChildProcess("shared#0")).toBe(replacement);
  acp.close();
});

it("constructs the real RPC client before spawn and replies to early frames only after its own receipt binds", async () => {
  const { child, JsonRpcClient } = await fixture();
  const release = await child.acquireHarnessBridge();
  const original = child.createChildProcessHandle("early-rpc");
  const source = receipt("early-rpc", 7);
  const pending = deferred<ReturnType<typeof receipt>>();
  let rpc!: InstanceType<typeof JsonRpcClient>;
  const request = vi.fn((id: string | number) => rpc.respond(id, { ok: true }));
  rpc = new JsonRpcClient(original, { onRequest: request });
  child.watchChild(
    original,
    (line) => rpc.pushLine(line),
    () => rpc.close(),
  );
  mocks.invoke.mockReturnValueOnce(pending.promise);
  const starting = child.spawnChild(original, "agent", [], "/fixture");
  mocks.handlers.get("harness-stdout")?.({
    payload: {
      sessionId: "early-rpc",
      constructionId: source.constructionId,
      line: JSON.stringify({ id: 9, method: "permission/read" }),
    } as never,
  });
  expect(request).not.toHaveBeenCalled();
  pending.resolve(source);
  await starting;
  expect(request).toHaveBeenCalledExactlyOnceWith(9, "permission/read", undefined);
  expect(mocks.invoke).toHaveBeenCalledWith("harness_write", {
    sessionId: "early-rpc",
    constructionId: source.constructionId,
    line: JSON.stringify({ jsonrpc: "2.0", id: 9, result: { ok: true } }),
  });
  rpc.close();
  release();
});

it("retains an already dispatched original RPC write past replacement and its bounded waiter without replay", async () => {
  const { child, JsonRpcClient } = await fixture();
  const original = child.createChildProcessHandle("same");
  const rpc = new JsonRpcClient(original, {}, { label: "original" });
  await child.spawnChild(original, "agent", [], "/fixture");
  const actual = deferred<void>();
  mocks.invoke.mockImplementationOnce(() => actual.promise);
  let retained: Promise<void> | undefined;
  let settled = false;
  vi.useFakeTimers();
  try {
    const waiter = rpc
      .respond(9, {}, (write) => {
        retained = write;
        void write.then(() => {
          settled = true;
        });
      })
      .catch((error: Error) => error);
    expect(retained).toBeDefined();
    const replacement = child.createChildProcessHandle("same");
    await child.spawnChild(replacement, "agent", [], "/fixture");
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await waiter).toEqual(
      expect.objectContaining({ message: expect.stringContaining("timed out") }),
    );
    expect(settled).toBe(false);
    actual.resolve();
    await retained;
    expect(settled).toBe(true);
    const writes = mocks.invoke.mock.calls.filter(([command]) => command === "harness_write");
    expect(writes).toHaveLength(1);
    expect(writes[0][1].constructionId).toBe(receipt("same", 1).constructionId);
    expect(child.captureChildProcess("same")).toBe(replacement);
  } finally {
    actual.resolve();
    await actual.promise;
    rpc.close();
  }
});

it.each([
  ["rpc-close", false],
  ["rpc-close", true],
  ["unwatch", false],
  ["unwatch", true],
  ["reject-pending", false],
  ["reject-pending", true],
] as const)(
  "keeps actual B metadata available after late A %s (B already exited: %s)",
  async (cleanup, exited) => {
    const { child, JsonRpcClient } = await fixture();
    const api = await import("./nativeOutputDelivery");
    const release = await child.acquireHarnessBridge();
    const route = `scope-${cleanup}-${exited}`;
    const a = child.createChildProcessHandle(route);
    const rpc = new JsonRpcClient(a, {});
    child.watchChild(a, (line) => rpc.pushLine(line), vi.fn());
    await child.spawnChild(a, "agent", [], "/fixture");
    emitNative(api, receipt(route, 1), JSON.stringify({ method: "original" }));
    const pending = rpc.request("kept-original", {}).catch((error: Error) => error);
    const b = child.createChildProcessHandle(route);
    child.watchChild(b, vi.fn(), vi.fn());
    await child.spawnChild(b, "agent", [], "/fixture");
    emitNative(api, receipt(route, 2), "replacement bytes");
    const inspectB = () =>
      api
        .inspectNativeOutputDelivery(route)
        .streams.find((stream) => stream.streamEpoch === receipt(route, 2).constructionId)!;
    await vi.waitFor(() =>
      expect(inspectB()).toMatchObject({ unavailableReason: null, receivedThrough: 1 }),
    );
    if (exited) {
      mocks.handlers.get("harness-exit")?.({
        payload: {
          sessionId: route,
          constructionId: receipt(route, 2).constructionId,
          pid: 42,
          code: 0,
        } as never,
      });
      expect(child.captureChildProcess(route)).toBeUndefined();
    } else expect(child.captureChildProcess(route)).toBe(b);
    try {
      if (cleanup === "rpc-close") rpc.close();
      else if (cleanup === "unwatch") child.unwatchChild(a);
      else rpc.rejectPending();
      const aReason =
        cleanup === "rpc-close"
          ? "rpc-client-closed"
          : cleanup === "unwatch"
            ? "child-unwatched"
            : "rpc-pending-rejected";
      const observed = api.inspectNativeOutputDelivery(route);
      expect(observed.retentionUnavailable).toBe(false);
      expect(
        observed.streams.find((stream) => stream.streamEpoch === receipt(route, 1).constructionId)
          ?.unavailableReason,
      ).toBe(aReason);
      expect(inspectB()).toMatchObject({
        unavailableReason: null,
        receivedThrough: 1,
        applicationThrough: null,
      });
    } finally {
      rpc.close();
      await pending;
      release();
    }
  },
);

it("keeps Pi's actual response consumer on A while closing A leaves B's Native metadata available", async () => {
  const { child } = await fixture();
  const { PiRpc } = await import("../providers/pi/piClient");
  const api = await import("./nativeOutputDelivery");
  const release = await child.acquireHarnessBridge();
  const route = "pi-original-consumer";
  const a = child.createChildProcessHandle(route);
  const rpc = new PiRpc(a, vi.fn());
  child.watchChild(a, (line) => rpc.pushLine(line), vi.fn());
  await child.spawnChild(a, "agent", [], "/fixture");
  const held = deferred<void>();
  const event = {};
  const actual = rpc.request({ type: "get_state" }, 15000, async (value, work) => {
    await held.promise;
    api.nativeOutputSink(work, () => api.captureNativeOutputEvent(route, event))();
    return value;
  });
  emitNative(
    api,
    receipt(route, 1),
    JSON.stringify({
      type: "response",
      id: "mc_1",
      command: "get_state",
      success: true,
      data: {},
    }),
  );
  const b = child.createChildProcessHandle(route);
  child.watchChild(b, vi.fn(), vi.fn());
  await child.spawnChild(b, "agent", [], "/fixture");
  emitNative(api, receipt(route, 2), "B replacement");
  const stream = (construction: number) =>
    api
      .inspectNativeOutputDelivery(route)
      .streams.find((value) => value.streamEpoch === receipt(route, construction).constructionId)!;
  try {
    await vi.waitFor(() => expect(stream(2).receivedThrough).toBe(1));
    expect(stream(1).pendingCausalWork).toBe(1);
    rpc.close();
    expect(stream(1)).toMatchObject({
      pendingCausalWork: 1,
      unavailableReason: "pi-client-closed",
    });
    expect(stream(2)).toMatchObject({ unavailableReason: null, receivedThrough: 1 });
    expect(api.inspectNativeOutputDelivery(route).retentionUnavailable).toBe(false);
    held.resolve();
    await actual;
    expect(api.getNativeOutputEventOrigin(event)).not.toBeNull();
    expect(stream(1)).toMatchObject({ pendingCausalWork: 0, applicationThrough: null });
    expect(child.captureChildProcess(route)).toBe(b);
  } finally {
    held.resolve();
    await actual;
    rpc.close();
    release();
  }
});

it("defers pending A invalidation to only its own receipt and remembers future A metadata without poisoning B", async () => {
  const { child } = await fixture();
  const api = await import("./nativeOutputDelivery");
  const release = await child.acquireHarnessBridge();
  const route = "pending-original-scope";
  const a = child.createChildProcessHandle(route);
  const held = deferred<ReturnType<typeof receipt>>();
  mocks.invoke.mockReturnValueOnce(held.promise).mockResolvedValueOnce(receipt(route, 2));
  const starting = child.spawnChild(a, "agent", [], "/fixture");
  child.invalidateChildOutput(a, "pending-original-closed");
  const b = child.createChildProcessHandle(route);
  child.watchChild(b, vi.fn(), vi.fn());
  await child.spawnChild(b, "agent", [], "/fixture");
  emitNative(api, receipt(route, 2), "B before A returns");
  expect(api.inspectNativeOutputDelivery(route).retentionUnavailable).toBe(false);
  held.resolve(receipt(route, 1));
  await starting;
  emitNative(api, receipt(route, 1), "late original A metadata");
  const observed = api.inspectNativeOutputDelivery(route);
  expect(observed.retentionUnavailable).toBe(false);
  expect(
    observed.streams.find((stream) => stream.streamEpoch === receipt(route, 1).constructionId)
      ?.unavailableReason,
  ).toBe("pending-original-closed");
  expect(
    observed.streams.find((stream) => stream.streamEpoch === receipt(route, 2).constructionId)
      ?.unavailableReason,
  ).toBeNull();
  release();
});

it.each([false, true])(
  "quarantines an invoked unidentified original before or after metadata (already observed: %s)",
  async (alreadyObserved) => {
    const { child } = await fixture();
    const api = await import("./nativeOutputDelivery");
    const release = await child.acquireHarnessBridge();
    const route = "unknown-original-scope";
    const a = child.createChildProcessHandle(route);
    const held = deferred<unknown>();
    mocks.invoke.mockReturnValueOnce(held.promise).mockResolvedValueOnce(receipt(route, 2));
    const starting = child.spawnChild(a, "agent", [], "/fixture").catch((error: Error) => error);
    child.invalidateChildOutput(a, "original-identity-unknown");
    const b = child.createChildProcessHandle(route);
    child.watchChild(b, vi.fn(), vi.fn());
    await child.spawnChild(b, "agent", [], "/fixture");
    if (alreadyObserved)
      emitNative(api, receipt(route, 2), "B present when original becomes unknown");
    held.resolve(42);
    expect(await starting).toBeInstanceOf(Error);
    expect(api.inspectNativeOutputDelivery(route)).toMatchObject({
      retentionUnavailable: true,
      qualified: false,
    });
    child.invalidateChildOutput(b, "later-exact-close");
    emitNative(
      api,
      receipt(route, 2),
      "future B does not clear unknown history",
      alreadyObserved ? 2 : 1,
    );
    expect(api.inspectNativeOutputDelivery(route).retentionUnavailable).toBe(true);
    release();
  },
);

it("skips Native invalidation for uninvoked handles and captured Host backends", async () => {
  const { child } = await fixture();
  const api = await import("./nativeOutputDelivery");
  const source = receipt("shared-with-native-data", 7);
  api.observeNativeOutputBatch(
    source.sessionId,
    "stdout",
    ["Native comparison data"],
    nativeMetadata(api, source, "Native comparison data"),
  );
  const uninvoked = child.createChildProcessHandle(source.sessionId);
  child.invalidateChildOutput(uninvoked, "unstarted-client-closed");
  child.configureChildBackend({
    invoke: vi.fn(async () => ({ ...source, backend: "host" as const })) as never,
    listen: async () => () => {},
  });
  const host = child.createChildProcessHandle(source.sessionId);
  await child.spawnChild(host, "agent", [], "/fixture");
  child.invalidateChildOutput(host, "host-client-closed");
  const observed = api.inspectNativeOutputDelivery(source.sessionId);
  expect(observed.retentionUnavailable).toBe(false);
  expect(observed.streams[0].unavailableReason).toBeNull();
});
