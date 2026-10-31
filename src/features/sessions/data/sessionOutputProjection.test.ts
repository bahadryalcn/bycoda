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
async function fullComparison(f: Awaited<ReturnType<typeof fixture>>, session: Session) {
  let token: ReturnType<typeof f.projection.getSessionOutputFullCandidate> = null;
  await vi.waitFor(() => {
    token = f.projection.getSessionOutputFullCandidate(session);
    expect(token).not.toBeNull();
    expect(f.projection.getSessionOutputFullCandidateComparison(token!)).not.toBeNull();
  });
  return {
    token: token!,
    comparison: f.projection.getSessionOutputFullCandidateComparison(token!)!,
  };
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
  const nativeWriteId = () => `55555555-5555-4555-8555-${revision.toString(16).padStart(12, "0")}`;
  mocks.invoke.mockImplementation(async (command: string, args: any) => {
    if (command === "session_upsert") {
      revision++;
      return {
        ...args.session,
        updatedAt: revision,
        transcriptRevision: revision,
        ...(args.captureOutputReceipt ? { nativeWriteId: nativeWriteId() } : {}),
      };
    }
    if (command === "session_apply_delta") {
      revision++;
      return {
        updatedAt: revision,
        revision,
        ...(args.captureOutputReceipt ? { nativeWriteId: nativeWriteId() } : {}),
      };
    }
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
  function emit(event: HarnessEvent, retain = false, project = true) {
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
    return { session: project ? apply(event) : model.getSessions()[0], work };
  }
  const state = () => projection.sessionOutputStorageObservation(initial.id);
  const pending = () => output.inspectNativeOutputDelivery(initial.id).streams[0].pendingCausalWork;
  return { initial, model, projection, persistence, output, apply, emit, state, pending };
}

it("flattens intentional multi-input ancestry into every exact original once at candidate admission", async () => {
  const f = await fixture();
  const first = f.emit({ type: "context", used: 1 }, true);
  const second = f.emit({ type: "context", used: 2 }, true);
  const joined = f.output.joinNativeOutputWorks([first.work!, second.work!], f.initial.id)!;
  expect(joined).not.toBeNull();
  first.work!.finish();
  second.work!.finish();
  const event: HarnessEvent = { type: "context", used: 3 };
  f.output.captureNativeOutputWorkEvent(joined, event);
  const session = f.apply(event);
  joined.finish();
  // The two earlier events and their joined later event share actual originals.
  expect(f.state().pendingOrigins).toBe(2);
  await f.persistence.upsertSession(session);
  const { token, comparison } = await fullComparison(f, session);
  expect(comparison.items.map((item) => [item.batch.sequence, item.itemIndex])).toEqual([
    [1, 0],
    [2, 0],
  ]);
  expect(f.state().acknowledgedOrigins).toBe(2);
  f.output.invalidateNativeOutputSession(f.initial.id, "one-original-retired");
  expect(f.projection.getSessionOutputFullCandidateComparison(token)).toBeNull();
});

it("admits no partial projection when a later joined constituent exhausts actual retention capacity", async () => {
  const f = await fixture();
  const first = f.emit({ type: "context", used: 1 }, true, false);
  const second = f.emit({ type: "context", used: 2 }, true, false);
  const joined = f.output.joinNativeOutputWorks([second.work!, first.work!], f.initial.id)!;
  first.work!.finish();
  second.work!.finish();
  const fillers = Array.from({ length: 127 }, () =>
    f.output.retainNativeOutputEventOrigin(first.work!.origin)!,
  );
  expect(fillers.every(Boolean)).toBe(true);
  const event: HarnessEvent = { type: "context", used: 3 };
  f.output.captureNativeOutputWorkEvent(joined, event);
  const session = f.apply(event);
  expect(f.state().pendingOrigins).toBe(0);
  expect(f.projection.sessionOutputFullCandidateObservation(session.id).unavailable).toBe(true);
  await f.persistence.upsertSession(session);
  expect(f.projection.getSessionOutputFullCandidate(session)).toBeNull();
  expect(f.output.getNativeOutputEventOriginComparisons(joined.origin)).toBeNull();
  joined.finish();
  fillers.forEach((work) => work.finish());
  expect(f.pending()).toBe(0);
});

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

it("a real drain flush owns the deferred save, and later application invalidates its boundary without cancelling the actual write", async () => {
  const f = await fixture();
  f.emit({ type: "context", used: 1 });
  const { rendererPersistenceDrain } = await import("./persistenceDrain");
  const gate = deferred<any>();
  mocks.invoke.mockReturnValueOnce(gate.promise);
  const attempt = rendererPersistenceDrain.beginAttempt([f.initial.id]);
  const observation = attempt.observe();
  const failedObservation = expect(observation).rejects.toMatchObject({ code: "late-producer" });
  try {
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    f.emit({ type: "context", used: 2 });
    await failedObservation;
    expect(f.state().pendingOrigins).toBe(2);
    expect(f.state().activeWrites).toBe(1);
    gate.resolve({ id: f.initial.id, updatedAt: 0, transcriptRevision: 0 });
    await f.persistence.flushSessionWrites();
    expect(f.state().pendingOrigins).toBe(1);
  } finally {
    attempt.abandon();
  }
  await f.persistence.flushSessionWritesStrict([f.initial.id]);
  expect(f.state()).toMatchObject({
    pendingOrigins: 0,
    applicationThrough: null,
    fullCheckpoint: false,
  });
});

it("retains genuine item comparisons and the exact immutable admitted payload after NORMAL ACK", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  const gate = deferred<any>();
  mocks.invoke.mockReturnValueOnce(gate.promise);
  const saving = f.persistence.upsertSession(session);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(f.projection.getSessionOutputFullCandidate(session)).toBeNull();
  expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
    inFlightCandidates: 1,
  });
  const admitted = mocks.invoke.mock.calls[0][1];
  expect(Object.isFrozen(admitted)).toBe(true);
  expect(Object.isFrozen(admitted.session.blocks[0])).toBe(true);
  gate.resolve({
    id: session.id,
    updatedAt: 12,
    transcriptRevision: 7,
    nativeWriteId: "55555555-5555-4555-8555-555555555555",
  });
  await saving;
  const { comparison } = await fullComparison(f, session);
  expect(comparison.admittedPayload).toBe(admitted);
  expect(admitted.captureOutputReceipt).toBe(true);
  expect(f.projection.sessionOutputFullCandidateObservation(session.id).payloadBytes)
    .toBe(new TextEncoder().encode(JSON.stringify(admitted)).byteLength);
  expect(comparison).toMatchObject({
    qualified: false,
    fullCheckpoint: false,
    applicationThrough: null,
    nativeCommitmentRequired: true,
    command: "session_upsert",
    acknowledgement: { kind: "replace", revision: 7, updatedAt: 12 },
    items: [{ kind: "native-output-item-comparison", itemIndex: 0, batch: { sequence: 1 } }],
  });
  expect(f.state().pendingOrigins).toBe(0);
  expect(f.pending()).toBe(0);
  expect(f.projection.getSessionOutputFullCandidate({ ...session })).toBeNull();
  expect(
    f.projection.getSessionOutputFullCandidateComparison({ kind: "session-output-full-candidate" }),
  ).toBeNull();
});

it("invalidates an acknowledged candidate on metadata edits without snapshotting historical origins again", async () => {
  const f = await fixture();
  const first = f.emit({ type: "context", used: 1 }).session;
  await f.persistence.upsertSession(first);
  const previous = await fullComparison(f, first);
  const next = { ...first, title: "Accepted edit" };
  f.model.setSessions([next]);
  expect(f.projection.getSessionOutputFullCandidateComparison(previous.token)).toBeNull();
  expect(f.projection.getSessionOutputFullCandidate(next)).toBeNull();
  expect(f.state().pendingOrigins).toBe(0);
  await f.persistence.upsertSession(next);
  expect(f.projection.getSessionOutputFullCandidate(next)).toBeNull();
  expect(mocks.invoke.mock.calls[1][1].captureOutputReceipt).toBeUndefined();
  expect(mocks.invoke.mock.calls[1][1].session.title).toBe("Accepted edit");
});

it("a later no-op event from the same original item revokes the earlier candidate", async () => {
  const f = await fixture();
  const original = f.emit({ type: "context", used: 1 }, true);
  await f.persistence.upsertSession(original.session);
  const previous = await fullComparison(f, original.session);
  const event: HarnessEvent = { type: "context", used: 1 };
  original.work!.run(() => f.output.captureNativeOutputEvent(f.initial.id, event));
  expect(f.apply(event)).toBe(original.session);
  expect(f.projection.getSessionOutputFullCandidateComparison(previous.token)).toBeNull();
  original.work!.finish();
  await f.persistence.upsertSession(original.session);
  expect((await fullComparison(f, original.session)).comparison.items).toHaveLength(1);
});

it("reset ABA retires comparison eligibility but retains the actual candidate/write until its real settlement", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  const gate = deferred<any>();
  mocks.invoke.mockReturnValueOnce(gate.promise);
  const saving = f.persistence.upsertSession(session);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  f.model.resetSessionsStore([{ ...session }]);
  expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
    retainedCandidates: 1,
    inFlightCandidates: 1,
  });
  expect(f.pending()).toBe(1);
  gate.resolve({ id: session.id, updatedAt: 1, transcriptRevision: 1 });
  await saving;
  expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
    retainedCandidates: 0,
    inFlightCandidates: 0,
    payloadBytes: 0,
    candidateOriginReferences: 0,
  });
  expect(f.projection.getSessionOutputFullCandidate(f.model.getSessions()[0])).toBeNull();
  expect(f.pending()).toBe(0);
});

it("a null CAS revokes the prior candidate and requires a real replacement acknowledgement", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  await f.persistence.upsertSession(session);
  const previous = await fullComparison(f, session);
  mocks.invoke.mockResolvedValueOnce(null);
  await f.persistence.upsertSession(session);
  expect(f.projection.getSessionOutputFullCandidateComparison(previous.token)).toBeNull();
  expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
    retainedCandidates: 0,
    replacementRequired: true,
  });
  await f.persistence.upsertSession(session);
  expect((await fullComparison(f, session)).comparison.acknowledgement.kind).toBe("replace");
});

it("a coalesced snapshot creates only the actually invoked delta comparison for its accepted descendant", async () => {
  const f = await fixture();
  const gate = deferred<any>();
  mocks.invoke.mockReturnValueOnce(gate.promise);
  const base = f.persistence.upsertSession(f.initial);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  const first = f.emit({ type: "context", used: 1 }).session;
  const saving = f.persistence.upsertSessionLive(first);
  const next = f.emit({ type: "context", used: 2 }).session;
  await f.persistence.upsertSessionLive(next);
  expect(f.projection.sessionOutputFullCandidateObservation(next.id).retainedCandidates).toBe(0);
  gate.resolve({ id: next.id, updatedAt: 1, transcriptRevision: 1 });
  await base;
  await saving;
  const { comparison } = await fullComparison(f, next);
  expect(comparison.command).toBe("session_apply_delta");
  expect(comparison.admittedPayload).toBe(mocks.invoke.mock.calls[1][1]);
  expect((comparison.admittedPayload as any).delta.session.contextUsed).toBe(2);
  expect(comparison.items.map((item) => item.batch.sequence)).toEqual([1, 2]);
});

it("capacity rejection preserves the ordinary sanitized write and real ACK without manufacturing a candidate", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  const text = "x".repeat(f.projection.SESSION_OUTPUT_FULL_LIMITS.payloadBytesPerCandidate + 1);
  const large = { ...session, blocks: [{ ...session.blocks[0], text }] };
  f.model.setSessions([large]);
  await f.persistence.upsertSession(large);
  expect(mocks.invoke.mock.calls[0][1].session.blocks[0].text).toBe(text);
  expect(mocks.invoke.mock.calls[0][1].captureOutputReceipt).toBeUndefined();
  expect(f.state().pendingOrigins).toBe(0);
  expect(f.pending()).toBe(0);
  expect(f.projection.getSessionOutputFullCandidate(large)).toBeNull();
  expect(f.projection.sessionOutputFullCandidateObservation(large.id)).toMatchObject({
    retainedCandidates: 0,
    payloadBytes: 0,
    unavailable: true,
  });
});

it("bounds held candidate admissions and supersession never releases actual write ownership", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  const handles: NonNullable<ReturnType<typeof f.projection.captureSessionOutputWrite>>[] = [];
  for (let index = 0; index < f.projection.SESSION_OUTPUT_FULL_LIMITS.candidates + 1; index++) {
    const handle = f.projection.captureSessionOutputWrite(session)!;
    handles.push(handle);
    f.projection.prepareSessionOutputWritePayload(
      handle,
      { session: { id: session.id, blocks: [] } },
      "replace",
    );
  }
  expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
    retainedCandidates: 128,
    inFlightCandidates: 128,
    unavailable: true,
  });
  expect(f.pending()).toBe(1);
  for (const handle of handles)
    f.projection.acknowledgeSessionOutputWrite(handle, {
      kind: "replace",
      revision: 1,
      updatedAt: 1,
    });
  expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
    retainedCandidates: 0,
    inFlightCandidates: 0,
    payloadBytes: 0,
    candidateOriginReferences: 0,
  });
  expect(f.pending()).toBe(0);
});

it("disposes a completed comparison and rechecks genuine original metadata rather than caching a prior positive claim", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  await f.persistence.upsertSession(session);
  const first = await fullComparison(f, session);
  f.projection.disposeSessionOutputFullCandidate(first.token);
  expect(f.projection.getSessionOutputFullCandidateComparison(first.token)).toBeNull();
  expect(f.projection.sessionOutputFullCandidateObservation(session.id).payloadBytes).toBe(0);
  await f.persistence.upsertSession(session);
  expect(f.projection.getSessionOutputFullCandidate(session)).toBeNull();
  expect(mocks.invoke.mock.calls[1][1].captureOutputReceipt).toBeUndefined();
  const fresh = f.emit({ type: "context", used: 2 }).session;
  await f.persistence.upsertSession(fresh);
  const next = await fullComparison(f, fresh);
  f.output.invalidateNativeOutputDelivery("fixture-source-reloaded");
  expect(f.projection.getSessionOutputFullCandidateComparison(next.token)).toBeNull();
});

it("leaves arguments untouched without inspecting them when only historical output remains", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  await f.persistence.upsertSession(session);
  const write = f.projection.captureSessionOutputWrite(session);
  const read = vi.fn(() => { throw new Error("must not inspect"); });
  const input = Object.defineProperty({}, "session", { enumerable: true, get: read });
  expect(f.projection.prepareSessionOutputWritePayload(write, input, "replace")).toBe(input);
  expect(read).not.toHaveBeenCalled();
  f.projection.releaseSessionOutputWrite(write);
});

it("defers busy output notices to the live tick and wakes persistence when it becomes idle", async () => {
  const f = await fixture();
  f.model.setSessions([{ ...f.initial, busy: true }]);
  await Promise.resolve();
  const notice = vi.fn();
  const unsubscribe = f.projection.subscribePendingSessionOutput(notice);
  try {
    const busy = f.emit({ type: "context", used: 1 }).session;
    await Promise.resolve();
    expect(notice).not.toHaveBeenCalled();
    f.model.setSessions([{ ...busy, busy: false }]);
    await Promise.resolve();
    expect(notice).toHaveBeenCalledTimes(1);
    expect(f.projection.pendingSessionOutputSnapshots()).toHaveLength(1);
  } finally {
    unsubscribe();
  }
});

it.each([undefined, "not-a-native-locator", "55555555-5555-4555-A555-555555555555"])(
  "legacy or malformed Native write locator %s preserves normal ACK without retaining a comparison",
  async (nativeWriteId) => {
    const f = await fixture();
    const session = f.emit({ type: "context", used: 1 }).session;
    mocks.invoke.mockResolvedValueOnce({
      id: session.id,
      updatedAt: 1,
      transcriptRevision: 1,
      nativeWriteId,
    });
    await f.persistence.upsertSession(session);
    expect(mocks.invoke.mock.calls[0][1].captureOutputReceipt).toBe(true);
    expect(f.state()).toMatchObject({ pendingOrigins: 0, acknowledgedOrigins: 1, failedWrites: 0 });
    expect(f.pending()).toBe(0);
    expect(f.projection.getSessionOutputFullCandidate(session)).toBeNull();
    expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
      retainedCandidates: 0,
      payloadBytes: 0,
      sessionOrigins: 1,
    });
    // A later genuine save can acquire a real locator without replaying provider effects.
    await f.persistence.upsertSession(session);
    expect((await fullComparison(f, session)).comparison.acknowledgement.nativeWriteId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  },
);

it("does not opt an ordinary save without genuine applied origins into Native receipt retention", async () => {
  const f = await fixture();
  await f.persistence.upsertSession(f.initial);
  expect(mocks.invoke.mock.calls[0][1].captureOutputReceipt).toBeUndefined();
  expect(f.projection.getSessionOutputFullCandidate(f.initial)).toBeNull();
});

it("best-effort comparison snapshot rejection preserves the original unsnapshotable invoke arguments", async () => {
  const f = await fixture();
  const session = f.emit({ type: "context", used: 1 }).session;
  const write = f.projection.captureSessionOutputWrite(session);
  const input: { session: { id: string; blocks: unknown[] }; cycle?: unknown } = {
    session: { id: session.id, blocks: [] },
  };
  input.cycle = input;
  expect(f.projection.prepareSessionOutputWritePayload(write, input, "replace")).toBe(input);
  expect(Object.hasOwn(input, "captureOutputReceipt")).toBe(false);
  expect(Object.isFrozen(input)).toBe(false);
  expect(f.projection.sessionOutputFullCandidateObservation(session.id)).toMatchObject({
    retainedCandidates: 0,
    unavailable: true,
  });
  // Ordinary result accounting still belongs to the actual caller, not the failed observer.
  f.projection.acknowledgeSessionOutputWrite(write, { kind: "replace", revision: 1, updatedAt: 1 });
  expect(f.pending()).toBe(0);
  expect(f.state().failedWrites).toBe(0);
});

it.each(["object", "array", "getter", "inherited-object", "inherited-array"] as const)(
  "preserves ordinary serialization through a custom %s toJSON instead of opting altered data into Native comparison",
  async (kind) => {
    const f = await fixture();
    const session = f.emit({ type: "context", used: 1 }).session;
    const write = f.projection.captureSessionOutputWrite(session);
    const original =
      kind === "array" || kind === "inherited-array" ? ["original"] : { text: "original" };
    const input = { session: { id: session.id, blocks: [original] } };
    const getter = vi.fn();
    const hook = vi.fn(function (this: unknown) {
      return this === original ? { text: "ordinary custom serialization" } : this;
    });
    const owner =
      kind === "inherited-object"
        ? Object.prototype
        : kind === "inherited-array"
          ? Array.prototype
          : original;
    const previous = Object.getOwnPropertyDescriptor(owner, "toJSON");
    let prepared!: typeof input;
    let ordinaryJson = "";
    let callsBeforeSend = -1;
    try {
      Object.defineProperty(
        owner,
        "toJSON",
        kind === "getter"
          ? {
              configurable: true,
              get() {
                getter();
                return hook;
              },
            }
          : { configurable: true, value: hook },
      );
      prepared = f.projection.prepareSessionOutputWritePayload(write, input, "replace");
      callsBeforeSend = hook.mock.calls.length + getter.mock.calls.length;
      // Native's ordinary JSON serialization retains its original hook receiver.
      ordinaryJson = JSON.stringify(prepared);
    } finally {
      if (previous) Object.defineProperty(owner, "toJSON", previous);
      else Reflect.deleteProperty(owner, "toJSON");
    }
    expect(prepared === input).toBe(true);
    expect(Object.hasOwn(prepared, "captureOutputReceipt")).toBe(false);
    expect(callsBeforeSend).toBe(0);
    expect(JSON.parse(ordinaryJson)).toEqual({
      session: { id: session.id, blocks: [{ text: "ordinary custom serialization" }] },
    });
    if (kind === "getter") expect(getter).toHaveBeenCalledOnce();
    f.projection.acknowledgeSessionOutputWrite(write, {
      kind: "replace",
      revision: 1,
      updatedAt: 1,
      nativeWriteId: "55555555-5555-4555-8555-555555555555",
    });
    expect(f.projection.getSessionOutputFullCandidate(session)).toBeNull();
    expect(f.projection.sessionOutputFullCandidateObservation(session.id).retainedCandidates).toBe(
      0,
    );
    expect(f.state()).toMatchObject({ pendingOrigins: 0, failedWrites: 0 });
  },
);

it.each(["custom-array-prototype", "standard-array-prototype"] as const)(
  "preserves ordinary serialization of a hole supplied by %s without changing the Native payload",
  async (kind) => {
    const f = await fixture();
    const session = f.emit({ type: "context", used: 1 }).session;
    const write = f.projection.captureSessionOutputWrite(session);
    const index = kind === "standard-array-prototype" ? 5000 : 0;
    const array: unknown[] = [];
    array.length = index + 1;
    const owner =
      kind === "custom-array-prototype" ? Object.create(Array.prototype) : Array.prototype;
    const previous = Object.getOwnPropertyDescriptor(owner, index);
    if (kind === "custom-array-prototype") Object.setPrototypeOf(array, owner);
    const input = { session: { id: session.id, blocks: array } };
    let prepared!: typeof input;
    let ordinaryJson = "";
    try {
      Object.defineProperty(owner, index, {
        configurable: true,
        value: "inherited ordinary value",
        writable: true,
      });
      prepared = f.projection.prepareSessionOutputWritePayload(write, input, "replace");
      ordinaryJson = JSON.stringify(prepared);
    } finally {
      if (previous) Object.defineProperty(owner, index, previous);
      else Reflect.deleteProperty(owner, index);
    }
    expect(prepared === input).toBe(true);
    expect(Object.hasOwn(prepared, "captureOutputReceipt")).toBe(false);
    const persisted = JSON.parse(ordinaryJson).session.blocks;
    expect(persisted).toHaveLength(index + 1);
    expect(persisted[index]).toBe("inherited ordinary value");
    f.projection.acknowledgeSessionOutputWrite(write, {
      kind: "replace",
      revision: 1,
      updatedAt: 1,
      nativeWriteId: "55555555-5555-4555-8555-555555555555",
    });
    expect(f.projection.getSessionOutputFullCandidate(session)).toBeNull();
    expect(f.pending()).toBe(0);
  },
);
