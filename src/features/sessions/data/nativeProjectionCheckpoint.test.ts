// @vitest-environment happy-dom
// Actual renderer model/closure/drain/save implementations with unit Native IO.
// These synthetic original frames/ACKs never establish a real Native/FULL join.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../model/session";
import type { ComposerDraft } from "../model/draftPersistence";
import type { NativeProducerInputClosure, NativeProducerInputLease } from "./mountedInputCapture";
import type {
  NativeProjectionPrepare,
  NativeProjectionCheckpointOptions,
} from "./nativeProjectionCheckpoint";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), globalListen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.globalListen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: mocks.listen }),
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const prepareId = (value = 1) => `10000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
async function fixture(mount = true) {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.globalListen.mockReset();
  const model = await import("../model/sessionsStore");
  const output = await import("../../../integrations/harness/core/nativeOutputDelivery");
  const projection = await import("./sessionOutputProjection");
  const persistence = await import("./sessionStore");
  const { rendererPersistenceDrain: drain } = await import("./persistenceDrain");
  const { createMountedComposerRegistry } = await import("./composerClosure");
  const receiver = await import("./nativeProjectionCheckpoint");
  const initial: Session = {
    id: "join_session",
    cwd: "/fixture",
    harness: "claude",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Join",
    blocks: [{ id: "user", role: "user", text: "hello" }],
    context: { used: 0, window: 100 },
  };
  model.resetSessionsStore([initial]);
  let revision = 0;
  const controls: {
    save?: (args: any, ack: any) => Promise<unknown>;
    prepared?: (args: any) => Promise<unknown>;
    verify?: (args: any) => Promise<unknown>;
    rawStatus?: (args: any) => Promise<unknown>;
    release?: (args: any) => Promise<unknown>;
  } = {};
  const ids = new Set([prepareId()]);
  mocks.invoke.mockImplementation((command: string, args: any) => {
    if (args?.prepareId) ids.add(args.prepareId);
    if (command === "session_upsert") {
      const ack = {
        id: args.session.id,
        updatedAt: ++revision,
        transcriptRevision: revision,
        ...(args.captureOutputReceipt
          ? { nativeWriteId: `55555555-5555-4555-8555-${revision.toString(16).padStart(12, "0")}` }
          : {}),
      };
      return controls.save?.(args, ack) ?? Promise.resolve(ack);
    }
    if (command === "native_projection_checkpoint_prepared")
      return controls.prepared?.(args) ?? Promise.resolve();
    if (command === "native_projection_checkpoint_verify")
      return controls.verify?.(args) ?? Promise.resolve({ qualified: false });
    if (command === "native_projection_checkpoint_raw_status")
      return (
        controls.rawStatus?.(args) ??
        Promise.resolve({ version: 1, qualified: false, status: "unknown" })
      );
    if (command === "native_projection_checkpoint_release")
      return controls.release?.(args) ?? Promise.resolve({ releaseReady: true });
    return Promise.resolve();
  });
  const publish = vi.fn(async () => {});
  const mounted = createMountedComposerRegistry({ registry: drain, publish });
  const gate = vi.fn();
  let draft: ComposerDraft = { text: " \n retained draft", attachments: [], mcpTags: [] };
  const input = document.createElement("textarea");
  input.value = draft.text;
  let composing = false;
  const lease = mount
    ? mounted.registerMountedComposer({
        sessionId: initial.id,
        gate,
        snapshot: () => ({ ...draft, text: input.value }),
        composing: () => composing,
      })
    : undefined!;
  const services: ReturnType<typeof receiver.createNativeProjectionCheckpointService>[] = [];
  const create = (options: NativeProjectionCheckpointOptions = {}) => {
    const service = receiver.createNativeProjectionCheckpointService({
      mountedBegin: mounted.beginComposerClosure,
      ...options,
    });
    services.push(service);
    return service;
  };
  cleanups.push(async () => {
    for (const service of services) {
      for (const id of ids)
        service.handleFinished({
          version: 1,
          qualified: false,
          prepareId: id,
          status: "cancelled",
        });
      await service.dispose();
    }
  });
  const scope = (overrides: Partial<NativeProjectionPrepare> = {}): NativeProjectionPrepare => ({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    environmentId: "fixture-env",
    sessionId: initial.id,
    migrationId: "fixture-migration",
    generation: 0,
    windowEpoch: "44444444-4444-4444-8444-444444444444",
    expiresInMs: 30_000,
    ...overrides,
  });
  const challenge = (request = scope()) => ({
    ...request,
    nonce: "66666666-6666-4666-8666-666666666666",
    roundId: "77777777-7777-4777-8777-777777777777",
  });
  let sequence = 0;
  function emit() {
    const event = { type: "context" as const, used: ++sequence };
    const lines = [JSON.stringify(event)];
    const tokens = output.observeNativeOutputBatch(initial.id, "stdout", lines, {
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
      ownerEpoch: scope().windowEpoch,
      sequence,
      channel: "stdout",
      itemCount: 1,
      utf8Bytes: Buffer.byteLength(lines[0]),
      payloadSha256: createHash("sha256")
        .update(output.frameNativeOutputItems("stdout", lines))
        .digest("hex"),
      digestEncoding: "bycoda-output-items-le/v1",
      available: true,
      unavailableReason: null,
    })!;
    output.deliverNativeOutputItem(tokens[0], () =>
      output.captureNativeOutputEvent(initial.id, event),
    );
    const session = { ...model.getSessions()[0], context: { used: sequence, window: 100 } };
    model.setSessions([session]);
    output.markNativeOutputEventsApplied(initial.id, [event]);
    projection.recordAppliedSessionOutput(session, [event]);
    return session;
  }
  const calls = (command: string) => mocks.invoke.mock.calls.filter(([name]) => name === command);
  const retainedRaw = (args: {
    nonce: string;
    rawCaptureJson: string;
    comparisonJson: string;
  }) => ({
    version: 1,
    qualified: false,
    status: "retained",
    receipt: {
      version: 1,
      sql: {
        version: 1,
        qualified: false,
        nonce: args.nonce,
        roundId: challenge().roundId,
        windowEpoch: scope().windowEpoch,
        environmentId: scope().environmentId,
        sessionId: initial.id,
        migrationId: scope().migrationId,
        generation: scope().generation,
        rawCapture: {
          version: 1,
          sha256: createHash("sha256").update(args.rawCaptureJson).digest("hex"),
          byteLength: Buffer.byteLength(args.rawCaptureJson),
          snapshotCount:
            JSON.parse(args.rawCaptureJson).snapshots.length +
            (JSON.parse(args.rawCaptureJson).producers?.length ?? 0),
          comparisonSha256: createHash("sha256").update(args.comparisonJson).digest("hex"),
        },
      },
    },
  });
  return {
    ...receiver,
    model,
    output,
    projection,
    persistence,
    drain,
    mounted,
    publish,
    gate,
    lease,
    input,
    setDraft(value: ComposerDraft) {
      draft = value;
      input.value = value.text;
    },
    setComposing(value: boolean) {
      composing = value;
    },
    controls,
    initial,
    scope,
    challenge,
    emit,
    calls,
    retainedRaw,
    create,
    ids,
    services,
  };
}

it("prepares real mounted drafts and a real covering save before observing the persistence boundary, then verifies the exact candidate once", async () => {
  const f = await fixture();
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.lease.canMutate()).toBe(false);
  expect(f.calls("session_upsert")).toHaveLength(1);
  const prepared = f.calls("native_projection_checkpoint_prepared")[0][1];
  expect(prepared.status).toBe("prepared");
  expect(JSON.parse(prepared.rawCaptureJson)).toMatchObject({
    version: 2,
    kind: "mounted-native-input-capture",
    producerCoverage: "unknown",
    producers: [],
    qualified: false,
    sessionId: f.initial.id,
    snapshots: [
      {
        id: 1,
        revision: 0,
        sessionId: f.initial.id,
        snapshot: { text: " \n retained draft", attachments: [], mcpTags: [] },
      },
    ],
  });
  const claim = JSON.parse(prepared.comparisonJson);
  expect(claim).toMatchObject({
    qualified: false,
    fullCheckpoint: false,
    nativeCommitmentRequired: true,
    items: [{ itemIndex: 0 }],
  });
  expect(prepared.missingCoverage).toContain("raw-editor-buffers");
  expect(service.observation().scopeComplete).toBe(false);
  await service.handleChallenge(f.challenge());
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_verify")[0][1].comparisonJson).toBe(
    prepared.comparisonJson,
  );
  expect(f.calls("native_projection_checkpoint_verify")[0][1].rawCaptureJson).toBe(
    prepared.rawCaptureJson,
  );
  expect(f.lease.canMutate()).toBe(false);
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "observed",
  });
  expect(f.lease.canMutate()).toBe(true);
  await service.handlePrepare(f.scope()); // Completed IDs cannot schedule another save.
  expect(f.calls("session_upsert")).toHaveLength(1);
});

it("forces only one actual full replacement when an earlier normal ACK supplied no Native candidate locator", async () => {
  const f = await fixture();
  const session = f.emit();
  f.controls.save = async (_args, ack) => {
    const { nativeWriteId: _id, ...legacy } = ack;
    return legacy;
  };
  await f.persistence.upsertSession(session);
  f.controls.save = undefined;
  const force = vi.fn(f.persistence.upsertSession);
  const service = f.create({ save: force });
  await service.handlePrepare(f.scope());
  expect(force).toHaveBeenCalledOnce();
  expect(f.calls("native_projection_checkpoint_prepared")[0][1].status).toBe("prepared");
});

it("reports a missing original candidate as unverified after at most one save and never creates an origin or verifies", async () => {
  const f = await fixture();
  const force = vi.fn(f.persistence.upsertSession);
  const service = f.create({ save: force });
  await service.handlePrepare(f.scope());
  expect(force).toHaveBeenCalledOnce();
  expect(f.calls("native_projection_checkpoint_prepared")[0][1]).toMatchObject({
    status: "unverified",
  });
  expect(f.calls("native_projection_checkpoint_prepared")[0][1].comparisonJson).toBeUndefined();
  expect(f.calls("native_projection_checkpoint_prepared")[0][1].rawCaptureJson).toBeUndefined();
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.lease.canMutate()).toBe(true);
});

it("rejects busy sessions before closing composers or admitting a save", async () => {
  const f = await fixture();
  f.model.setSessions([{ ...f.initial, busy: true }]);
  const service = f.create();
  await service.handlePrepare(f.scope());
  expect(f.calls("native_projection_checkpoint_prepared")[0][1].status).toBe("busy");
  expect(f.calls("native_projection_checkpoint_prepared")[0][1].rawCaptureJson).toBeUndefined();
  expect(f.gate).not.toHaveBeenCalledWith(true);
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.calls("session_upsert")).toHaveLength(0);
  expect(f.model.getSessions()[0].busy).toBe(true);
});

it("does not consume foreign scope/nonces or duplicate a prepare while its real prepared reply is held", async () => {
  const f = await fixture();
  f.emit();
  const held = deferred();
  f.controls.prepared = () => held.promise;
  const service = f.create();
  const preparing = service.handlePrepare(f.scope());
  await vi.waitFor(() => expect(f.calls("native_projection_checkpoint_prepared")).toHaveLength(1));
  const replay = service.handlePrepare(f.scope({ expiresInMs: 29_000 }));
  expect(replay).toBe(preparing);
  for (const changes of [
    { sessionId: "other" },
    { windowEpoch: "88888888-8888-4888-8888-888888888888" },
    { generation: 1 },
  ])
    await service.handleChallenge({ ...f.challenge(), ...changes });
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  await service.handleChallenge(f.challenge()); // A real response can precede its IPC ACK.
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  await service.handleChallenge({
    ...f.challenge(),
    nonce: "99999999-9999-4999-8999-999999999999",
  });
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  held.resolve(undefined);
  await preparing;
});

it("revokes the prepared boundary on later accepted-model mutation without stopping the session or resending Native verification", async () => {
  const f = await fixture();
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  f.model.setSessions([{ ...f.model.getSessions()[0], title: "new accepted title" }]);
  await vi.waitFor(() => expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1));
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.model.getSessions()[0].title).toBe("new accepted title");
  expect(f.lease.canMutate()).toBe(true);
});

it("cancellation with releaseReady false retains its closure and actual held save until Native finished and actual IO separately settle", async () => {
  const f = await fixture();
  f.emit();
  const held = deferred();
  let ack: unknown;
  f.controls.save = async (_args, value) => {
    ack = value;
    return held.promise;
  };
  f.controls.release = async () => ({ releaseReady: false });
  const service = f.create();
  const preparing = service.handlePrepare(f.scope());
  await vi.waitFor(() => expect(f.calls("session_upsert")).toHaveLength(1));
  await service.cancel(prepareId());
  await preparing;
  expect(f.lease.canMutate()).toBe(false);
  expect(service.observation()).toMatchObject({ activePrepares: 1, actualJobs: 1, releasing: 1 });
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(99),
    status: "cancelled",
  });
  expect(f.lease.canMutate()).toBe(false);
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "cancelled",
  });
  expect(f.lease.canMutate()).toBe(true);
  expect(service.observation().actualJobs).toBe(1);
  held.resolve(ack);
  await vi.waitFor(() => expect(service.observation().activePrepares).toBe(0));
});

it("expiry with an unknown release reply keeps owned gates until a Native finished acknowledgement and does not retry IO", async () => {
  const f = await fixture();
  const session = f.emit();
  await f.persistence.upsertSession(session);
  await vi.waitFor(() =>
    expect(
      f.projection.getSessionOutputFullCandidateComparison(
        f.projection.getSessionOutputFullCandidate(session)!,
      ),
    ).not.toBeNull(),
  );
  f.controls.release = async () => {
    throw new Error("unit unknown release ACK");
  };
  const service = f.create();
  vi.useFakeTimers();
  const preparing = service.handlePrepare(f.scope({ expiresInMs: 100 }));
  await vi.advanceTimersByTimeAsync(0);
  await preparing;
  await vi.advanceTimersByTimeAsync(101);
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(f.lease.canMutate()).toBe(false);
  await service.cancel(prepareId());
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "unverified",
    reason: "Native round reopened\nwithout promotion",
  });
  expect(f.lease.canMutate()).toBe(true);
});

it("captures actual sessionless Quick work without manufacturing a Session candidate or writing a fake row", async () => {
  const f = await fixture();
  f.model.resetSessionsStore([]);
  const { createQuickComposerClosureRuntime } =
    await import("../../quick-composer/model/quickComposerClosure");
  const quick = createQuickComposerClosureRuntime(f.mounted);
  const state = quick.window({
    prompt: "retained quick",
    attachments: [],
    cwd: "/fixture",
    choice: { harness: "claude", model: "fixture" },
    modelSettings: {},
    pickedRuntimeMode: "supervised",
    workspaceChoice: { cwd: "/fixture", mode: "current" },
  });
  const owner = quick.bind(state);
  const gate = vi.fn();
  const detach = owner.mount({ gate });
  const begin = vi.fn(quick.begin);
  const service = f.create({ quickBegin: begin });
  await service.handlePrepare(f.scope());
  expect(begin).toHaveBeenCalledOnce();
  expect(f.calls("native_projection_checkpoint_prepared")[0][1].status).toBe("unverified");
  expect(f.calls("session_upsert")).toHaveLength(0);
  expect(owner.currentPrompt()).toBe("retained quick");
  expect(gate).toHaveBeenCalledWith(true);
  expect(owner.canMutate()).toBe(true);
  await detach();
});

it("installs finished/challenge first and retains finished delivery during disposal until release is acknowledged", async () => {
  const f = await fixture();
  f.emit();
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const unlistened: string[] = [];
  mocks.listen.mockImplementation(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(name, handler);
      return () => {
        handlers.delete(name);
        unlistened.push(name);
      };
    },
  );
  f.controls.release = async () => ({ releaseReady: false });
  const installed = f.installNativeProjectionCheckpointReceiver({
    mountedBegin: f.mounted.beginComposerClosure,
  });
  f.services.push(installed.service);
  await installed.ready;
  expect(mocks.listen.mock.calls.map(([name]) => name)).toEqual([
    "native-projection-finished",
    "native-projection-challenge",
    "native-projection-prepare",
  ]);
  expect(mocks.globalListen).not.toHaveBeenCalled();
  await installed.service.handlePrepare(f.scope());
  const disposing = installed.dispose();
  await vi.waitFor(() => expect(unlistened).toContain("native-projection-prepare"));
  expect(handlers.has("native-projection-finished")).toBe(true);
  handlers.get("native-projection-finished")!({
    payload: { version: 1, qualified: false, prepareId: prepareId(), status: "cancelled" },
  });
  await disposing;
  expect(handlers.size).toBe(0);
  expect(f.lease.canMutate()).toBe(true);
});

it("retains the real Native verification promise after cancellation and finished acknowledgement without replaying it", async () => {
  const f = await fixture();
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  const held = deferred();
  f.controls.verify = () => held.promise;
  f.controls.release = async () => ({ releaseReady: false });
  const verifying = service.handleChallenge(f.challenge());
  await vi.waitFor(() => expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1));
  await service.cancel(prepareId());
  await verifying;
  expect(service.observation().actualJobs).toBe(1);
  expect(f.lease.canMutate()).toBe(false);
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "cancelled",
  });
  expect(f.lease.canMutate()).toBe(true);
  expect(service.observation().actualJobs).toBe(1);
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  held.resolve({ qualified: false });
  await vi.waitFor(() => expect(service.observation().activePrepares).toBe(0));
});

it("never reopens another owner's composer closure when preparation is refused", async () => {
  const f = await fixture();
  f.emit();
  const owner = {};
  const outside = f.mounted.beginComposerClosure([f.initial.id], { owner });
  const service = f.create();
  try {
    await service.handlePrepare(f.scope());
    expect(f.calls("native_projection_checkpoint_prepared")[0][1].status).toBe("unverified");
    expect(f.lease.canMutate()).toBe(false);
    expect(f.calls("session_upsert")).toHaveLength(0);
  } finally {
    outside.reopen(owner);
  }
  expect(f.lease.canMutate()).toBe(true);
});

it("bounds unresolved owned preparations and refuses more work while Native release remains unconfirmed", async () => {
  const f = await fixture();
  const sessions = Array.from({ length: 5 }, (_, index) => ({
    ...f.initial,
    id: `capacity_${index}`,
  }));
  f.model.resetSessionsStore(sessions);
  f.controls.release = async () => ({ releaseReady: false });
  const service = f.create();
  for (let index = 0; index < sessions.length; index++)
    await service.handlePrepare(
      f.scope({ prepareId: prepareId(index + 1), sessionId: sessions[index].id }),
    );
  expect(service.observation()).toMatchObject({ activePrepares: 4, releasing: 4 });
  // The first unresolved round retains the physical-window editor gate, so
  // the other accepted request records cannot admit another transcript save.
  expect(f.calls("session_upsert")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_prepared")).toHaveLength(4);
  for (let index = 0; index < 4; index++)
    service.handleFinished({
      version: 1,
      qualified: false,
      prepareId: prepareId(index + 1),
      status: "unverified",
    });
  expect(service.observation().activePrepares).toBe(0);
});

it("ignores malformed or self-qualified prepare DTOs without closing real input or writing data", async () => {
  const f = await fixture();
  const service = f.create();
  for (const value of [
    { ...f.scope(), qualified: true },
    { ...f.scope(), windowEpoch: "label-only" },
    { ...f.scope(), expiresInMs: 60_000 },
  ])
    await service.handlePrepare(value);
  expect(f.calls("native_projection_checkpoint_prepared")).toHaveLength(0);
  expect(f.calls("session_upsert")).toHaveLength(0);
  expect(f.lease.canMutate()).toBe(true);
});

it.each(["", " \n\t"])(
  "retains exact %j text and two actual mounts through prepare and the same challenge bytes",
  async (text) => {
    const f = await fixture();
    f.setDraft({ text, attachments: [], mcpTags: [], mode: "save" });
    const unassigned = {
      text: " \n unassigned raw ",
      attachments: [
        { id: "opaque", name: "raw", data: "exact", nested: { preserved: [null, true] } },
      ],
      mcpTags: [{ token: "@opaque", server: { arbitrary: "retained data" } }],
    } as unknown as ComposerDraft;
    f.mounted.registerMountedComposer({ snapshot: () => unassigned });
    f.emit();
    const service = f.create();
    await service.handlePrepare(f.scope());
    const prepared = f.calls("native_projection_checkpoint_prepared")[0][1];
    expect(prepared.status).toBe("prepared");
    expect(JSON.parse(prepared.rawCaptureJson)).toEqual({
      version: 2,
      kind: "mounted-native-input-capture",
      producerCoverage: "unknown",
      producerEpochs: { parent: expect.any(Number), editor: expect.any(Number) },
      producers: [],
      qualified: false,
      sessionId: f.initial.id,
      snapshots: [
        {
          id: 1,
          revision: 0,
          sessionId: f.initial.id,
          snapshot: { text, mcpTags: [], attachments: [], mode: "save" },
        },
        { id: 2, revision: 0, snapshot: unassigned },
      ],
    });
    expect(prepared.missingCoverage).toContain("unassigned-composers");
    expect(prepared.missingCoverage).toEqual(
      expect.arrayContaining(f.NATIVE_PROJECTION_MISSING_COVERAGE),
    );
    await service.handleChallenge(f.challenge());
    const verified = f.calls("native_projection_checkpoint_verify")[0][1];
    expect(verified.rawCaptureJson).toBe(prepared.rawCaptureJson);
    expect(verified.comparisonJson).toBe(prepared.comparisonJson);
    expect(service.observation().qualified).toBe(false);
    expect(f.calls("session_upsert")).toHaveLength(1);
  },
);

it("distinguishes an actual zero-mount roster from a producer that supplied no raw snapshots", async () => {
  const f = await fixture(false);
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  const prepared = f.calls("native_projection_checkpoint_prepared")[0][1];
  expect(prepared.status).toBe("prepared");
  expect(JSON.parse(prepared.rawCaptureJson).snapshots).toEqual([]);
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")[0][1].rawCaptureJson).toBe(
    prepared.rawCaptureJson,
  );
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "observed",
  });
  const missing = f.create({
    mountedBegin: () => ({
      captureAndFlush: async () => ({ missingCoverage: ["missing-producer"] }),
      assertCurrent: () => {},
      reopen: () => {},
    }),
  });
  await missing.handlePrepare(f.scope({ prepareId: prepareId(2) }));
  const refused = f.calls("native_projection_checkpoint_prepared")[1][1];
  expect(refused.status).toBe("unverified");
  expect(refused.rawCaptureJson).toBeUndefined();
  expect(refused.comparisonJson).toBeUndefined();
  expect(refused.missingCoverage).toContain("raw-capture-capture-unavailable");
});

it("retains the actual restored-file undefined optional and nested MCP option through both Native messages", async () => {
  const f = await fixture();
  const { markMissingAttachments } = await import("../model/queuePersistence");
  const { newMcpTag } = await import("../model/mcpPicker");
  const [restored] = await markMissingAttachments(
    [
      {
        id: "draft",
        text: "restored",
        attachments: [
          {
            id: "real-restored",
            name: "restored.txt",
            kind: "file",
            size: 1,
            mimeType: "text/plain",
            path: "/fixture/restored.txt",
            missing: true,
          },
        ],
      },
    ],
    async () => new Set(["/fixture/restored.txt"]),
  );
  expect(Object.hasOwn(restored.attachments[0], "missing")).toBe(true);
  expect(restored.attachments[0].missing).toBeUndefined();
  const tag = newMcpTag(
    {
      provider: "claude",
      name: "sample",
      scope: "project",
      configPath: "/fixture/mcp",
      transport: "stdio",
      enabled: undefined,
    },
    [],
  );
  f.setDraft({
    text: "restored",
    attachments: restored.attachments,
    mcpTags: [tag],
    mode: undefined,
  });
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  const prepared = f.calls("native_projection_checkpoint_prepared")[0][1];
  expect(prepared.status).toBe("prepared");
  const retained = JSON.parse(prepared.rawCaptureJson).snapshots[0];
  expect(retained.undefinedPaths).toEqual(
    expect.arrayContaining([
      ["attachments", 0, "missing"],
      ["mcpTags", 0, "server", "enabled"],
      ["mode"],
    ]),
  );
  expect(retained.snapshot.attachments[0]).toMatchObject({
    id: "real-restored",
    path: "/fixture/restored.txt",
  });
  expect(Object.hasOwn(retained.snapshot.attachments[0], "missing")).toBe(false);
  expect(Object.hasOwn(retained.snapshot.mcpTags[0].server, "enabled")).toBe(false);
  expect(Object.hasOwn(retained.snapshot, "mode")).toBe(false);
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")[0][1].rawCaptureJson).toBe(
    prepared.rawCaptureJson,
  );
});

it.each([false, true])(
  "detects a silent optional-object presence change from own undefined=%j",
  async (present) => {
    const f = await fixture();
    const file: ComposerDraft["attachments"][number] = {
      id: "presence",
      name: "presence.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      ...(present ? { missing: undefined } : {}),
    };
    f.setDraft({ text: "presence", attachments: [file], mcpTags: [] });
    f.emit();
    const service = f.create();
    await service.handlePrepare(f.scope());
    expect(f.calls("native_projection_checkpoint_prepared")[0][1].status).toBe("prepared");
    if (present) delete file.missing;
    else file.missing = undefined;
    await service.handleChallenge(f.challenge());
    expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
    expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  },
);

it("detects a silent DOM value change without relying on a cache or input notification before verify", async () => {
  const f = await fixture();
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  const prepared = f.calls("native_projection_checkpoint_prepared")[0][1];
  f.input.value = "silent unpublished DOM value";
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(JSON.parse(prepared.rawCaptureJson).snapshots[0].snapshot.text).toBe(" \n retained draft");
  expect(f.input.value).toBe("silent unpublished DOM value");
  expect(f.calls("session_upsert")).toHaveLength(1);
});

it("rechecks the actual mount after a held Native verify settles without replaying that verification", async () => {
  const f = await fixture();
  f.emit();
  const held = deferred();
  f.controls.verify = () => held.promise;
  const service = f.create();
  await service.handlePrepare(f.scope());
  const verifying = service.handleChallenge(f.challenge());
  await vi.waitFor(() => expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1));
  f.input.value = "late silent DOM mutation";
  held.resolve({ qualified: false });
  await verifying;
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  expect(f.input.value).toBe("late silent DOM mutation");
});

it("holds a newly started IME composition after capture without committing it to authorize raw verification", async () => {
  const f = await fixture();
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  f.setComposing(true);
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(f.input.value).toBe(" \n retained draft");
});

it("captures an already admitted preparation's late raw result only after its actual settlement", async () => {
  const f = await fixture();
  f.emit();
  const held = deferred();
  const preparing = f.lease.prepare(async (accepted) => {
    await held.promise;
    accepted.apply(() => {
      f.input.value = "late original attachment intent";
    });
  });
  const service = f.create();
  const capture = service.handlePrepare(f.scope());
  await vi.waitFor(() => expect(f.gate).toHaveBeenCalledWith(true));
  expect(f.calls("native_projection_checkpoint_prepared")).toHaveLength(0);
  held.resolve(undefined);
  await preparing;
  await capture;
  const prepared = f.calls("native_projection_checkpoint_prepared")[0][1];
  expect(prepared.status).toBe("prepared");
  expect(JSON.parse(prepared.rawCaptureJson).snapshots[0]).toMatchObject({
    revision: 1,
    snapshot: { text: "late original attachment intent" },
  });
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")[0][1].rawCaptureJson).toBe(
    prepared.rawCaptureJson,
  );
});

it("does not revive raw verification after an accepted model changes and returns to its old object", async () => {
  const f = await fixture();
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  const prior = f.model.getSessions()[0];
  f.model.setSessions([{ ...prior, title: "intervening model" }]);
  f.model.setSessions([prior]);
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(f.calls("session_upsert")).toHaveLength(1);
});

it("holds an oversized raw artifact without truncation, Native verification or a new transcript save", async () => {
  const f = await fixture();
  const { NATIVE_RAW_CAPTURE_LIMITS } = await import("./nativeRawCapture");
  f.setDraft({ text: "x".repeat(NATIVE_RAW_CAPTURE_LIMITS.bytes), attachments: [], mcpTags: [] });
  f.emit();
  const service = f.create();
  await service.handlePrepare(f.scope());
  const refused = f.calls("native_projection_checkpoint_prepared")[0][1];
  expect(refused.status).toBe("unverified");
  expect(refused.rawCaptureJson).toBeUndefined();
  expect(refused.missingCoverage).toContain("raw-capture-capacity");
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("session_upsert")).toHaveLength(0);
  expect(f.input.value.length).toBe(NATIVE_RAW_CAPTURE_LIMITS.bytes);
});

it("never retries raw prepare or verify after the original prepared acknowledgement becomes unknown", async () => {
  const f = await fixture();
  f.emit();
  f.controls.prepared = async () => {
    throw new Error("lost prepared acknowledgement");
  };
  f.controls.release = async () => ({ releaseReady: false });
  const service = f.create();
  await service.handlePrepare(f.scope());
  expect(f.calls("native_projection_checkpoint_prepared")[0][1].rawCaptureJson).toBeTypeOf(
    "string",
  );
  await service.handlePrepare(f.scope());
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_prepared")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(f.lease.canMutate()).toBe(false);
  expect(f.calls("session_upsert")).toHaveLength(1);
});

it("observes a retained raw artifact once after an actual rejected verify but still releases the failed verification", async () => {
  const f = await fixture();
  f.emit();
  const model = f.model.getSessions()[0];
  f.controls.verify = async () => {
    throw new Error("lost actual FULL commit acknowledgement");
  };
  f.controls.rawStatus = async (args) => f.retainedRaw(args);
  f.controls.release = async () => ({ releaseReady: false });
  const service = f.create();
  await service.handlePrepare(f.scope());
  await service.handleChallenge(f.challenge());
  expect(service.observation()).toMatchObject({
    retainedRaw: true,
    qualified: false,
    scopeComplete: false,
    releasing: 1,
  });
  const rawStatus = f.calls("native_projection_checkpoint_raw_status")[0][1];
  const verify = f.calls("native_projection_checkpoint_verify")[0][1];
  expect(rawStatus).toEqual(verify);
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(f.model.getSessions()[0]).toBe(model);
  expect(f.lease.canMutate()).toBe(false);
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  expect(f.calls("session_upsert")).toHaveLength(1);
});

it.each([
  "missing-receipt",
  "qualified",
  "nonce",
  "raw-hash",
  "comparison-hash",
  "count",
  "pending",
])("does not upgrade failed verification from a %s raw status response", async (kind) => {
  const f = await fixture();
  f.emit();
  f.controls.verify = async () => {
    throw new Error("verify outcome unknown");
  };
  f.controls.release = async () => ({ releaseReady: false });
  f.controls.rawStatus = async (args) => {
    const result: any = f.retainedRaw(args);
    if (kind === "missing-receipt") delete result.receipt;
    if (kind === "qualified") result.qualified = true;
    if (kind === "nonce") result.receipt.sql.nonce = "99999999-9999-4999-8999-999999999999";
    if (kind === "raw-hash") result.receipt.sql.rawCapture.sha256 = "0".repeat(64);
    if (kind === "comparison-hash") result.receipt.sql.rawCapture.comparisonSha256 = "0".repeat(64);
    if (kind === "count") result.receipt.sql.rawCapture.snapshotCount++;
    if (kind === "pending") result.status = "pending";
    return result;
  };
  const service = f.create();
  await service.handlePrepare(f.scope());
  await service.handleChallenge(f.challenge());
  expect(service.observation()).toMatchObject({
    retainedRaw: false,
    qualified: false,
    releasing: 1,
  });
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  expect(f.calls("session_upsert")).toHaveLength(1);
});

it("bounds the status waiter while retaining its actual IO through a late read result", async () => {
  const f = await fixture();
  f.emit();
  const held = deferred();
  let args: any;
  f.controls.verify = async () => {
    throw new Error("verify outcome unknown");
  };
  f.controls.rawStatus = (request) => {
    args = request;
    return held.promise;
  };
  f.controls.release = async () => ({ releaseReady: false });
  const service = f.create();
  await service.handlePrepare(f.scope());
  await service.handleChallenge(f.challenge());
  expect(service.observation()).toMatchObject({
    retainedRaw: false,
    actualJobs: 1,
    activePrepares: 1,
    releasing: 1,
  });
  expect(f.calls("native_projection_checkpoint_release")).toHaveLength(1);
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "cancelled",
  });
  expect(service.observation().actualJobs).toBe(1);
  held.resolve(f.retainedRaw(args));
  await vi.waitFor(() => expect(service.observation().activePrepares).toBe(0));
  expect(service.observation().retainedRaw).toBe(false);
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
});

it("does not attach a retained-raw diagnostic after a silent source change during the read", async () => {
  const f = await fixture();
  f.emit();
  f.controls.verify = async () => {
    throw new Error("verify outcome unknown");
  };
  f.controls.release = async () => ({ releaseReady: false });
  f.controls.rawStatus = async (args) => {
    f.input.value = "changed while raw status was reading";
    return f.retainedRaw(args);
  };
  const service = f.create();
  await service.handlePrepare(f.scope());
  await service.handleChallenge(f.challenge());
  expect(service.observation()).toMatchObject({
    retainedRaw: false,
    qualified: false,
    releasing: 1,
  });
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  expect(f.input.value).toBe("changed while raw status was reading");
});

it("does not start raw recovery after cancellation wins over an actual still-pending verify", async () => {
  const f = await fixture();
  f.emit();
  const held = deferred();
  f.controls.verify = () => held.promise;
  const service = f.create();
  await service.handlePrepare(f.scope());
  const verifying = service.handleChallenge(f.challenge());
  await vi.waitFor(() => expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1));
  await service.cancel(prepareId());
  await verifying;
  held.reject(new Error("late actual verify rejection"));
  await vi.waitFor(() => expect(service.observation().activePrepares).toBe(0));
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
});

function capturedProducers(sessionId: string) {
  let valid = true;
  const release = vi.fn(() => {
    valid = false;
  });
  const value: NativeProducerInputLease = {
    parent: {
      registryEpoch: 3,
      snapshots: [
        {
          id: 1,
          revision: 2,
          kind: "question-draft",
          sessionId,
          snapshot: { questionId: "original", answer: " unsent ", optional: undefined },
        },
      ],
    },
    editor: {
      registryEpoch: 4,
      snapshots: [
        {
          id: 1,
          revision: 5,
          kind: "file-editor",
          snapshot: {
            path: "/isolated/file",
            text: " unsaved\r\n",
            native: { receipt: undefined },
          },
        },
      ],
    },
    missingCoverage: ["parent-admission-closure", "editor-admission-closure"],
    current: () => valid,
    release,
  };
  return {
    value,
    release,
    invalidate: () => {
      valid = false;
    },
  };
}

function inputClosure(
  capture: () => Promise<NativeProducerInputLease>,
): NativeProducerInputClosure {
  let active = true;
  return {
    capture,
    current: () => active,
    release: () => {
      active = false;
    },
  };
}

it("captures Parent/editor inputs after the existing drain and binds identical bytes to verification", async () => {
  const f = await fixture();
  f.emit();
  let drained = false;
  f.drain.registerProducer("producer-order-control", {
    flush: async () => {
      drained = true;
    },
  });
  const producers = capturedProducers(f.initial.id);
  const captureInputs = vi.fn(async () => {
    expect(drained).toBe(true);
    return producers.value;
  });
  const service = f.create({ beginInputs: () => inputClosure(captureInputs) });
  await service.handlePrepare(f.scope());
  const prepared = f.calls("native_projection_checkpoint_prepared")[0][1];
  const body = JSON.parse(prepared.rawCaptureJson);
  expect(body.producerEpochs).toEqual({ parent: 3, editor: 4 });
  expect(body.producers.map((entry: { id: number }) => entry.id)).toEqual([2, 3]);
  expect(body.producers[0].snapshot.answer).toBe(" unsent ");
  expect(body.producers[1].snapshot.text).toBe(" unsaved\r\n");
  expect(body.producerCoverage).toBe("unknown");
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")[0][1].rawCaptureJson).toBe(
    prepared.rawCaptureJson,
  );
  expect(captureInputs).toHaveBeenCalledOnce();
  expect(service.observation().qualified).toBe(false);
  await service.cancel(prepareId());
  expect(producers.release).toHaveBeenCalledOnce();
});

it("holds verification when the actual Parent/editor producer lease changes after prepare", async () => {
  const f = await fixture();
  f.emit();
  const producers = capturedProducers(f.initial.id);
  const service = f.create({ beginInputs: () => inputClosure(async () => producers.value) });
  await service.handlePrepare(f.scope());
  producers.invalidate();
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(0);
  expect(producers.release).toHaveBeenCalledOnce();
});

it("keeps late producer acquisition charged after cancellation and releases its actual late lease", async () => {
  const f = await fixture();
  f.emit();
  const held = deferred<NativeProducerInputLease>();
  const captureInputs = vi.fn(() => held.promise);
  const producers = capturedProducers(f.initial.id);
  const service = f.create({ beginInputs: () => inputClosure(captureInputs) });
  const preparing = service.handlePrepare(f.scope());
  await vi.waitFor(() => expect(captureInputs).toHaveBeenCalledOnce());
  await service.cancel(prepareId());
  await preparing;
  expect(service.observation().activePrepares).toBe(1);
  held.resolve(producers.value);
  await vi.waitFor(() => expect(service.observation().activePrepares).toBe(0));
  expect(producers.release).toHaveBeenCalledOnce();
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
});

it("recovers only retained data for the full Composer/Parent/editor count after a lost verify reply", async () => {
  const f = await fixture();
  f.emit();
  const producers = capturedProducers(f.initial.id);
  f.controls.verify = async () => {
    throw new Error("lost actual reply");
  };
  f.controls.rawStatus = async (args) => f.retainedRaw(args);
  f.controls.release = async () => ({ releaseReady: false });
  const service = f.create({ beginInputs: () => inputClosure(async () => producers.value) });
  await service.handlePrepare(f.scope());
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(1);
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(1);
  expect(service.observation().retainedRaw).toBe(true);
  expect(service.observation().qualified).toBe(false);
  expect(service.observation().scopeComplete).toBe(false);
});

it("closes actual producer admission before Composer/drain and keeps it closed until matching Native release", async () => {
  const f = await fixture();
  f.emit();
  const events: string[] = [];
  const producers = capturedProducers(f.initial.id);
  const closed = inputClosure(async () => {
    events.push("capture-inputs");
    return producers.value;
  });
  const releaseGate = vi.fn(() => {
    events.push("release-inputs");
  });
  closed.release = releaseGate;
  f.drain.registerProducer("admission-order", {
    flush: async () => {
      events.push("drain");
    },
  });
  f.controls.release = async () => ({ releaseReady: false });
  const service = f.create({
    beginInputs: () => {
      events.push("close-inputs");
      return closed;
    },
    mountedBegin: (scope, options) => {
      events.push("close-composer");
      return f.mounted.beginComposerClosure(scope, options);
    },
  });
  await service.handlePrepare(f.scope());
  expect(events.indexOf("close-inputs")).toBeLessThan(events.indexOf("close-composer"));
  expect(events.indexOf("drain")).toBeLessThan(events.indexOf("capture-inputs"));
  await service.cancel(prepareId());
  expect(releaseGate).not.toHaveBeenCalled();
  expect(producers.release).not.toHaveBeenCalled();
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(99),
    status: "cancelled",
  });
  expect(releaseGate).not.toHaveBeenCalled();
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "cancelled",
  });
  expect(releaseGate).toHaveBeenCalledOnce();
  expect(producers.release).toHaveBeenCalledOnce();
  expect(f.lease.canMutate()).toBe(true);
});

it("does not verify a still-matching snapshot after its actual admission scope became invalid", async () => {
  const f = await fixture();
  f.emit();
  const producers = capturedProducers(f.initial.id);
  const closed = inputClosure(async () => producers.value);
  const service = f.create({ beginInputs: () => closed });
  await service.handlePrepare(f.scope());
  expect(producers.value.current()).toBe(true);
  closed.current = () => false;
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(0);
});

it("waits for original Parent and editor work while rejecting new work through the actual registries", async () => {
  const f = await fixture();
  f.emit();
  const { registerParentInput } = await import("./parentInputClosure");
  const { registerMountedEditor } = await import("../../files/data/mountedEditorClosure");
  let answer = "before";
  let text = "before";
  let editorClosed = false;
  const parent = registerParentInput({
    kind: "question-draft",
    sessionId: f.initial.id,
    snapshot: () => ({ answer }),
  });
  const editor = registerMountedEditor(() => ({ snapshot: { text } }), {
    canClose: () => true,
    close: (closed) => {
      editorClosed = closed;
    },
  });
  cleanups.push(async () => {
    parent.release();
    editor.unregister();
  });
  const parentWork = parent.admit()!;
  const editorWork = editor.operation("original-save")!;
  const service = f.create();
  const preparing = service.handlePrepare(f.scope());
  await vi.waitFor(() => expect(editorClosed).toBe(true));
  expect(parent.admit()).toBeNull();
  expect(editor.operation("new-save")).toBeNull();
  expect(f.calls("native_projection_checkpoint_prepared")).toHaveLength(0);
  parentWork.apply(() => {
    answer = "late original answer";
  });
  parentWork.finish();
  editorWork.apply(() => {
    text = "late original document\r\n";
    editor.changed();
  });
  // A completed Parent callback does not settle the independently owned editor.
  await Promise.resolve();
  expect(f.calls("native_projection_checkpoint_prepared")).toHaveLength(0);
  editorWork();
  await preparing;
  const raw = JSON.parse(f.calls("native_projection_checkpoint_prepared")[0][1].rawCaptureJson);
  expect(raw.producers.map((producer: { snapshot: unknown }) => producer.snapshot)).toEqual(
    expect.arrayContaining([
      { answer: "late original answer" },
      { text: "late original document\r\n" },
    ]),
  );
  f.controls.release = async () => ({ releaseReady: false });
  await service.cancel(prepareId());
  expect(editorClosed).toBe(true);
  expect(parent.admit()).toBeNull();
  service.handleFinished({
    version: 1,
    qualified: false,
    prepareId: prepareId(),
    status: "cancelled",
  });
  expect(editorClosed).toBe(false);
  const reopened = parent.admit();
  expect(reopened).not.toBeNull();
  reopened!.finish();
});

it("invalidates the actual editor gate after an external ABA update without discarding that update", async () => {
  const f = await fixture();
  f.emit();
  const { registerMountedEditor } = await import("../../files/data/mountedEditorClosure");
  let text = "same bytes";
  const editor = registerMountedEditor(() => ({ snapshot: { text } }), {
    canClose: () => true,
    close: () => {},
  });
  cleanups.push(async () => {
    editor.unregister();
  });
  const service = f.create();
  await service.handlePrepare(f.scope());
  editor.external(() => {
    text = "external content";
  });
  expect(text).toBe("external content");
  editor.external(() => {
    text = "same bytes";
  });
  await service.handleChallenge(f.challenge());
  expect(f.calls("native_projection_checkpoint_verify")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_raw_status")).toHaveLength(0);
  expect(text).toBe("same bytes");
});

it("does not start Composer closure or persistence when the actual Parent scope already has active IME", async () => {
  const f = await fixture();
  f.emit();
  const { registerParentInput } = await import("./parentInputClosure");
  const parent = registerParentInput({
    kind: "question-draft",
    sessionId: f.initial.id,
    composing: () => true,
    snapshot: () => ({ answer: "unfinished composition" }),
  });
  cleanups.push(async () => {
    parent.release();
  });
  const mountedBegin = vi.fn(f.mounted.beginComposerClosure);
  const flush = vi.fn(async () => {});
  const service = f.create({ mountedBegin, flush });
  await service.handlePrepare(f.scope());
  expect(mountedBegin).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
  expect(f.calls("session_upsert")).toHaveLength(0);
  expect(f.calls("native_projection_checkpoint_prepared")[0][1]).toMatchObject({
    status: "unverified",
    missingCoverage: expect.arrayContaining(["input-admission-unavailable"]),
  });
  expect(parent.canMutate()).toBe(true);
});
