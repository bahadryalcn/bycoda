// @vitest-environment happy-dom
import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../model/session";
import type { HarnessEvent } from "../../../integrations/harness/core/types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
afterEach(() => {
  mocks.invoke.mockReset();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture() {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  const model = await import("../model/sessionsStore");
  const projection = await import("./sessionOutputProjection");
  const persistence = await import("./sessionStore");
  const output = await import("../../../integrations/harness/core/nativeOutputDelivery");
  const { applyHarnessEvents } = await import("../../../integrations/harness/core/apply");
  const initial: Session = {
    id: "projection",
    cwd: "/fixture",
    harness: "claude",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Fixture",
    context: { used: 0, window: 100 },
    blocks: [{ id: "user", role: "user", text: "hello" }],
  };
  model.resetSessionsStore([initial]);
  let revision = 0;
  mocks.invoke.mockImplementation(async (command: string, args: any) => {
    if (command === "session_upsert")
      return { ...args.session, updatedAt: ++revision, transcriptRevision: revision };
    if (command === "session_apply_delta") return { updatedAt: ++revision, revision };
    return undefined;
  });
  let sequence = 0;
  function apply(event: HarnessEvent) {
    const before = model.getSessions()[0];
    const next = applyHarnessEvents(before, [event]);
    if (next !== before) model.setSessions([next]);
    output.markNativeOutputEventsApplied(initial.id, [event]);
    projection.recordAppliedSessionOutput(next, [event]);
    return next;
  }
  function emit(event: HarnessEvent, retain = false) {
    const items = [JSON.stringify(event)];
    const bytes = output.frameNativeOutputItems("stdout", items);
    const tokens = output.observeNativeOutputBatch(initial.id, "stdout", items, {
      version: 1,
      qualified: false,
      processEpoch: "11111111-1111-4111-8111-111111111111",
      streamEpoch: "22222222-2222-4222-8222-222222222222",
      streamKind: "process",
      sessionId: initial.id,
      sourceStoreId: "fixture-store",
      sourceProfileId: "fixture-profile",
      storeInstance: "33333333-3333-4333-8333-333333333333",
      processId: 42,
      ownerEpoch: "44444444-4444-4444-8444-444444444444",
      sequence: ++sequence,
      channel: "stdout",
      itemCount: 1,
      utf8Bytes: new TextEncoder().encode(items[0]).length,
      payloadSha256: createHash("sha256").update(bytes).digest("hex"),
      digestEncoding: "bycoda-output-items-le/v1",
      available: true,
      unavailableReason: null,
    });
    let work: ReturnType<typeof output.captureNativeOutputWork> = null;
    output.deliverNativeOutputItem(tokens![0], () => {
      output.captureNativeOutputEvent(initial.id, event);
      if (retain) work = output.captureNativeOutputWork();
    });
    return { session: apply(event), work };
  }
  const state = () => projection.sessionOutputStorageObservation(initial.id);
  const pending = () => output.inspectNativeOutputDelivery(initial.id).streams[0].pendingCausalWork;
  return { initial, model, projection, persistence, output, apply, emit, state, pending };
}

it("holds the actual applied origin through an unresolved normal write; its ACK is not a FULL checkpoint", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  const gate = deferred<any>();
  mocks.invoke.mockReturnValueOnce(gate.promise);
  const saving = f.persistence.upsertSession(session);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(f.state().pendingOrigins).toBe(1);
  expect(f.pending()).toBe(1);
  gate.resolve({
    id: session.id,
    cwd: session.cwd,
    harness: session.harness,
    updatedAt: 1,
    transcriptRevision: 1,
  });
  await saving;
  expect(f.state()).toMatchObject({
    pendingOrigins: 0,
    acknowledgedOrigins: 1,
    qualified: false,
    fullCheckpoint: false,
    applicationThrough: null,
  });
  expect(f.pending()).toBe(0);
});

it("coalesces a later accepted model snapshot without treating replacement as an ACK", async () => {
  const f = await fixture();
  const first = deferred<any>();
  mocks.invoke.mockReturnValueOnce(first.promise);
  const baseSave = f.persistence.upsertSession(f.initial);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  const a = f.emit({ type: "context", used: 1 }).session;
  const queued = f.persistence.upsertSessionLive(a);
  const b = f.emit({ type: "context", used: 2 }).session;
  await f.persistence.upsertSessionLive(b);
  expect(f.state().pendingOrigins).toBe(2);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  first.resolve({ id: f.initial.id, updatedAt: 1, transcriptRevision: 1 });
  await baseSave;
  await queued;
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(mocks.invoke.mock.calls[1][1].delta.session.contextUsed).toBe(2);
  expect(f.state()).toMatchObject({ pendingOrigins: 0, acknowledgedOrigins: 2 });
});

it("an older ACK cannot cover a later actual reducer no-op from the same native item", async () => {
  const f = await fixture();
  const a = f.emit({ type: "context", used: 1 }, true);
  const first = deferred<any>();
  mocks.invoke.mockReturnValueOnce(first.promise);
  const saving = f.persistence.upsertSession(a.session);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  const later: HarnessEvent = { type: "context", used: 1 };
  a.work!.run(() => f.output.captureNativeOutputEvent(f.initial.id, later));
  expect(f.apply(later)).toBe(a.session);
  a.work!.finish();
  first.resolve({ id: f.initial.id, updatedAt: 1, transcriptRevision: 1 });
  await saving;
  expect(f.state().pendingOrigins).toBe(1);
  expect(f.projection.needsSessionOutputWrite(a.session)).toBe(true);
  await f.persistence.upsertSession(a.session);
  expect(f.state().pendingOrigins).toBe(0);
});

it("a failed delta remains held without auto-retry and the next actual full replacement can recover it", async () => {
  const f = await fixture();
  await f.persistence.upsertSession(f.initial);
  const a = f.emit({ type: "context", used: 1 }).session;
  mocks.invoke.mockRejectedValueOnce(new Error("unknown native ACK"));
  await f.persistence.upsertSessionLive(a);
  expect(f.state()).toMatchObject({ pendingOrigins: 1, failedWrites: 1 });
  const calls = mocks.invoke.mock.calls.length;
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.invoke).toHaveBeenCalledTimes(calls);
  await f.persistence.upsertSessionLive(a);
  expect(mocks.invoke.mock.calls.at(-1)![0]).toBe("session_upsert");
  expect(f.state().pendingOrigins).toBe(0);
});

it("a later delta receipt cannot resolve an earlier unknown write", async () => {
  const f = await fixture();
  const a = f.emit({ type: "context", used: 1 }).session;
  f.projection.failSessionOutputWrite(f.projection.captureSessionOutputWrite(a));
  f.projection.acknowledgeSessionOutputWrite(f.projection.captureSessionOutputWrite(a), {
    kind: "delta",
    revision: 1,
    updatedAt: 1,
  });
  expect(f.state().pendingOrigins).toBe(1);
  f.projection.acknowledgeSessionOutputWrite(f.projection.captureSessionOutputWrite(a), {
    kind: "replace",
    revision: 2,
    updatedAt: 2,
  });
  expect(f.state().pendingOrigins).toBe(0);
});

it("reset and identical ID reuse retain actual in-flight work but cannot acknowledge the new model", async () => {
  const f = await fixture();
  const a = f.emit({ type: "context", used: 1 }).session;
  const gate = deferred<any>();
  mocks.invoke.mockReturnValueOnce(gate.promise);
  const saving = f.persistence.upsertSession(a);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  f.model.resetSessionsStore([{ ...a }]);
  expect(f.pending()).toBe(1);
  gate.resolve({ id: a.id, updatedAt: 1, transcriptRevision: 1 });
  await saving;
  expect(f.state().acknowledgedOrigins).toBe(0);
  expect(f.output.inspectNativeOutputDelivery(a.id).streams[0].unavailableReason).toBe(
    "session-projection-replaced",
  );
});

it("a forged write token and malformed acknowledgement cannot consume retained origins", async () => {
  const f = await fixture();
  const a = f.emit({ type: "context", used: 1 }).session;
  f.projection.acknowledgeSessionOutputWrite(
    { kind: "session-output-write" },
    { kind: "replace", revision: 1, updatedAt: 1 },
  );
  expect(f.state().pendingOrigins).toBe(1);
  f.projection.acknowledgeSessionOutputWrite(f.projection.captureSessionOutputWrite(a), {
    kind: "replace",
    revision: Number.NaN,
    updatedAt: 1,
  });
  expect(f.state()).toMatchObject({ pendingOrigins: 1, failedWrites: 1 });
});

it("strict flush writes an accepted projection before its UI timer has admitted a save", async () => {
  const f = await fixture();
  f.emit({ type: "context", used: 1 });
  await f.persistence.flushSessionWritesStrict([f.initial.id]);
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toContain("session_upsert");
  expect(f.state()).toMatchObject({
    pendingOrigins: 0,
    fullCheckpoint: false,
    applicationThrough: null,
  });
});

it("bounds idle no-op persistence to one coalesced slot while the first actual write is held", async () => {
  const f = await fixture();
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useSessionPersistence, useSessionPersistenceRefs } =
    await import("../../../app/workspace/sessions/useSessionPersistence");
  const first = deferred<any>();
  mocks.invoke.mockReturnValueOnce(first.promise);
  function Probe() {
    useSessionPersistence({
      refs: useSessionPersistenceRefs(),
      sessions: f.model.useLiveSessions(),
      tabsRef: { current: [] },
      sidebarCwdRef: { current: "/fixture" },
      removingSessionIds: { current: new Set() },
      switchingWorktrees: { current: new Map() },
      setHistory: vi.fn(),
      localHostReachable: { current: true },
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(createElement(Probe)));
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 20; index++)
      await act(async () => {
        f.emit({ type: "context", used: 0 });
      });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ pendingOrigins: 20, activeWrites: 1 });
    await act(async () => {
      first.resolve({ id: f.initial.id, updatedAt: 0, transcriptRevision: 0 });
      await f.persistence.flushSessionWrites();
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(f.state()).toMatchObject({ pendingOrigins: 0, activeWrites: 0 });
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});

it("metadata write capacity cannot evict an origin or fabricate an ACK", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  const handles = Array.from({ length: 4096 }, () =>
    f.projection.captureSessionOutputWrite(session),
  );
  expect(handles.every(Boolean)).toBe(true);
  expect(f.projection.captureSessionOutputWrite(session)).toBeNull();
  expect(f.state()).toMatchObject({ pendingOrigins: 1, activeWrites: 4096, unavailable: true });
  for (const handle of handles) f.projection.releaseSessionOutputWrite(handle);
  expect(f.state()).toMatchObject({ pendingOrigins: 1, activeWrites: 0, unavailable: true });
});
