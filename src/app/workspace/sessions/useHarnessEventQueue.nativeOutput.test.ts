// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import vectors from "../../../integrations/harness/core/nativeOutputDelivery.fixture.json";
import type { Session } from "../../../features/sessions/model/session";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (value: { payload: any }) => void>(),
  invoke: vi.fn(async () => 42),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await vi.importActual<object>("@tauri-apps/api/core")),
  invoke: mocks.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (value: { payload: any }) => void) => {
    mocks.handlers.set(name, handler);
    return () => mocks.handlers.delete(name);
  }),
}));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
let release: (() => void) | undefined;
afterEach(async () => {
  release?.();
  release = undefined;
  if (root) await act(() => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  mocks.handlers.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fixture(includeSession = true) {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  const { useHarnessEventQueue } = await import("./useHarnessEventQueue");
  const child = await import("../../../integrations/harness/core/child");
  const audit = await import("../../../integrations/harness/core/nativeOutputDelivery");
  const store = await import("../../../features/sessions/model/sessionsStore");
  const session: Session = {
    id: "session",
    harness: "claude",
    model: "fixture",
    title: "Fixture",
    cwd: "/fixture",
    blocks: [],
  };
  store.resetSessionsStore(includeSession ? [session] : []);
  let queue!: ReturnType<typeof useHarnessEventQueue>;
  function Probe() {
    queue = useHarnessEventQueue({
      tabsRef: { current: [] },
      activeTabIdRef: { current: "" },
      foregroundSurfaceRef: { current: { workspaceVisible: false } },
    });
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(createElement(Probe)));
  release = await child.acquireHarnessBridge();
  const vector = vectors.cases[0];
  const metadata = {
    version: 1,
    qualified: false,
    processEpoch: "11111111-1111-4111-8111-111111111111",
    streamEpoch: "22222222-2222-4222-8222-222222222222",
    streamKind: "process",
    sessionId: "session",
    sourceStoreId: "store",
    sourceProfileId: "profile",
    storeInstance: "33333333-3333-4333-8333-333333333333",
    processId: 42,
    ownerEpoch: "44444444-4444-4444-8444-444444444444",
    sequence: 1,
    channel: "stdout",
    itemCount: vector.items.length,
    utf8Bytes: vector.utf8Bytes,
    payloadSha256: vector.sha256,
    digestEncoding: "bycoda-output-items-le/v1",
    available: true,
    unavailableReason: null,
  };
  const emit = (items = vector.items, output = metadata) =>
    mocks.handlers.get("harness-stdout-lines")!({
      payload: { sessionId: "session", lines: items, nativeOutput: output },
    });
  return { child, audit, store, queue, emit, metadata, vector };
}

it("carries original native batch lineage through the real child listener, deferred queue and actual session reducer", async () => {
  const f = await fixture();
  f.child.watchChild(
    "session",
    (text) => f.queue.enqueueHarnessEvent("session", { type: "message.delta", text }),
    () => {},
  );
  f.emit();
  expect(f.store.getSessions()[0].blocks).toEqual([]);
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    queuedEvents: 3,
    appliedEvents: 0,
  });
  f.queue.flushHarnessEvents();
  expect(JSON.stringify(f.store.getSessions()[0].blocks)).toContain("İ漢🦀");
  await vi.waitFor(() =>
    expect(f.audit.inspectNativeOutputDelivery("session").streams[0].deliveredThrough).toBe(1),
  );
  expect(f.audit.inspectNativeOutputDelivery("session")).toMatchObject({
    qualified: false,
    coverage: "unverified",
    streams: [{ queuedEvents: 3, appliedEvents: 3, applicationThrough: null }],
  });
});

it("preserves original batch identity when owned output waits for a watcher", async () => {
  const f = await fixture();
  await f.child.spawnChild("session", "fixture-agent", [], "/fixture");
  f.emit();
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0].queuedEvents).toBe(0);
  f.child.watchChild(
    "session",
    (text) => f.queue.enqueueHarnessEvent("session", { type: "message.delta", text }),
    () => {},
  );
  f.queue.flushHarnessEvents();
  await vi.waitFor(() =>
    expect(f.audit.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
      deliveredThrough: 1,
      queuedEvents: 3,
      appliedEvents: 3,
      unavailableReason: null,
    }),
  );
});

it("marks a real missing session application unavailable while preserving handler delivery", async () => {
  const f = await fixture(false);
  const received: string[] = [];
  f.child.watchChild(
    "session",
    (text) => {
      received.push(text);
      f.queue.enqueueHarnessEvent("session", { type: "message.delta", text });
    },
    () => {},
  );
  f.emit();
  f.queue.flushHarnessEvents();
  expect(received).toEqual(f.vector.items);
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    appliedEvents: 0,
    unavailableReason: "session-application-missing",
  });
  expect(f.store.getSessions()).toEqual([]);
});

it("retains legacy bounded-buffer behavior while exposing an actual native item loss", async () => {
  const f = await fixture();
  await f.child.spawnChild("session", "fixture-agent", [], "/fixture");
  const items = Array.from({ length: 1001 }, (_, index) => `line-${index}`);
  const framed = f.audit.frameNativeOutputItems("stdout", items);
  f.emit(items, {
    ...f.metadata,
    itemCount: items.length,
    utf8Bytes: items.reduce((sum, text) => sum + Buffer.byteLength(text), 0),
    payloadSha256: createHash("sha256").update(framed).digest("hex"),
  });
  const received: string[] = [];
  f.child.watchChild(
    "session",
    (text) => received.push(text),
    () => {},
  );
  expect(received).toEqual(items.slice(1));
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    unavailableReason: "buffer-dropped",
    deliveredThrough: 0,
  });
});

it("accepts the separate post-reader state event without emitting a second legacy exit", async () => {
  const f = await fixture();
  const exit = vi.fn();
  f.child.watchChild("session", () => {}, exit);
  await f.child.spawnChild("session", "fixture-agent", [], "/fixture");
  f.emit();
  const fields = [
    "version",
    "qualified",
    "processEpoch",
    "streamEpoch",
    "streamKind",
    "sessionId",
    "sourceStoreId",
    "sourceProfileId",
    "storeInstance",
    "processId",
    "ownerEpoch",
  ];
  const state = {
    ...Object.fromEntries(fields.map((key) => [key, f.metadata[key as keyof typeof f.metadata]])),
    lastSequence: 1,
    state: "unsealed",
    reason: null,
  };
  mocks.handlers.get("harness-exit")!({
    payload: { sessionId: "session", code: 0, pid: 42, nativeOutputState: state },
  });
  expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0].nativeState).toBe("unsealed");
  mocks.handlers.get("harness-output-state")!({
    payload: { sessionId: "session", nativeOutputState: { ...state, state: "sealed" } },
  });
  expect(exit).toHaveBeenCalledTimes(1);
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    nativeState: "sealed",
    applicationThrough: null,
  });
});

it("marks already-terminal buffered output unavailable before an ordinary global reset drops it", async () => {
  const f = await fixture();
  await f.child.spawnChild("session", "fixture-agent", [], "/fixture");
  f.emit();
  await vi.waitFor(() =>
    expect(f.audit.inspectNativeOutputDelivery("session").streams[0].receivedThrough).toBe(1),
  );
  const fields = [
    "version",
    "qualified",
    "processEpoch",
    "streamEpoch",
    "streamKind",
    "sessionId",
    "sourceStoreId",
    "sourceProfileId",
    "storeInstance",
    "processId",
    "ownerEpoch",
  ];
  mocks.handlers.get("harness-output-state")!({
    payload: {
      sessionId: "session",
      nativeOutputState: {
        ...Object.fromEntries(
          fields.map((key) => [key, f.metadata[key as keyof typeof f.metadata]]),
        ),
        lastSequence: 1,
        state: "sealed",
        reason: null,
      },
    },
  });
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    nativeState: "sealed",
    deliveredThrough: 0,
    unavailableReason: null,
  });
  await f.child.killAllChildren();
  const received: string[] = [];
  f.child.watchChild(
    "session",
    (text) => received.push(text),
    () => {},
  );
  expect(received).toEqual([]);
  expect(f.audit.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    nativeState: "sealed",
    deliveredThrough: 0,
    unavailableReason: "children-reset",
  });
});
