// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NoteInputWork } from "./notesInputOwners";
import type { NotesInputClosure } from "./notesInputClosure";

let owners: typeof import("./notesInputOwners");
let facade: typeof import("./notesInputClosure");
let intents: typeof import("./noteServiceIntents");
const roots: NoteInputWork[] = [];
const gates: NotesInputClosure[] = [];
const settle: (() => void)[] = [];
beforeEach(async () => {
  vi.resetModules();
  Reflect.deleteProperty(
    globalThis,
    Symbol.for("bycoda.note-service-intents.v1"),
  );
  Reflect.deleteProperty(
    globalThis,
    Symbol.for("bycoda.mounted-notes-input-closure.v1"),
  );
  owners = await import("./notesInputOwners");
  facade = await import("./notesInputClosure");
  intents = await import("./noteServiceIntents");
});
afterEach(async () => {
  gates.splice(0).forEach((gate) => gate.release());
  settle.splice(0).forEach((finish) => finish());
  roots.splice(0).forEach((work) => work());
  owners.noteActivityOwner().retire();
  await Promise.resolve();
});
function original() {
  const work = owners.requireNoteWork("actual-notes-service-call");
  roots.push(work);
  return work;
}
function close() {
  const gate = facade.beginNotesInputClosure("unrelated-target", {
    owner: {},
    timeoutMs: 10_000,
  });
  gates.push(gate);
  return gate;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  settle.push(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
async function captured() {
  const lease = await facade.captureNotesInputs("unrelated-target");
  const service = lease.snapshots.find(
    (row) => row.snapshot.surface === "service-intents",
  )!;
  expect(service.kind).toBe("note-editor");
  expect(service).not.toHaveProperty("sessionId");
  expect(service.snapshot).toMatchObject({
    version: 1,
    qualified: false,
    rosterComplete: false,
    origin: "local-native",
    coverage: "unknown",
  });
  return {
    lease,
    service,
    records: service.snapshot.records as Record<string, any>[],
  };
}
/** Leaves one unverified record: Native succeeded but local bookkeeping failed. */
async function fail(
  command: Parameters<typeof intents.beginNoteServiceIntent>[0],
  args: Record<string, unknown>,
  error: unknown = new Error("Native outcome uncertain"),
) {
  const work = original();
  const effect = vi.fn(() => Promise.resolve(undefined));
  try {
    await intents.beginNoteServiceIntent(command, args, work).execute(effect, () => {
      throw error;
    });
  } finally {
    work();
  }
  expect(effect).toHaveBeenCalledOnce();
}

it("retains exact service-only original requests including CRLF and own undefined without an editor or ACK", async () => {
  const request = {
    note: {
      id: "original-note",
      body: " \r\nç 😀\t",
      title: "",
      tags: [],
      expectedUpdatedAt: 17,
      sourceSessionId: "original-other-session",
      untouched: undefined,
    },
  };
  const work = original(),
    actual = deferred<unknown>(),
    nativeError = new Error("original local bookkeeping failure");
  const call = intents.beginNoteServiceIntent("notes_upsert", request, work);
  const invoked = vi.fn(() => actual.promise);
  const pending = call.execute(invoked, () => {
    throw nativeError;
  });
  expect(invoked).toHaveBeenCalledOnce();
  request.note.id = "later-caller-mutation";
  request.note.body = "later-caller-body";
  actual.resolve(undefined);
  await expect(pending).resolves.toBeUndefined();
  work();
  const { lease, service, records } = await captured();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    command: "notes_upsert",
    status: "unverified",
    phase: "result-application-unverified",
    args: {
      note: {
        id: "original-note",
        body: " \r\nç 😀\t",
        title: "",
        expectedUpdatedAt: 17,
        sourceSessionId: "original-other-session",
      },
    },
  });
  expect(Object.hasOwn(records[0].args.note, "untouched")).toBe(true);
  expect(records[0].args.note.untouched).toBeUndefined();
  expect(service.snapshot).not.toHaveProperty("nativeDraftReceipt");
  expect(lease.missingCoverage).toContain("notes-service-outcome-unverified");
  const { encodeNativeProducerCapture } =
    await import("../sessions/data/nativeProducerCapture");
  const raw = JSON.parse(
    encodeNativeProducerCapture(
      "unrelated-target",
      { qualified: false, missingCoverage: [], snapshots: [] },
      {
        parent: { registryEpoch: 0, snapshots: [] },
        editor: { registryEpoch: 0, snapshots: [] },
        notes: lease,
      },
    ),
  );
  expect(raw.version).toBe(3);
  const wire = raw.producers.find(
    (row: any) => row.snapshot.surface === "service-intents",
  );
  expect(wire.undefinedPaths).toContainEqual([
    "records",
    0,
    "args",
    "note",
    "untouched",
  ]);
  expect(wire.snapshot.records[0].args.note.body).toBe(" \r\nç 😀\t");
  lease.release();
});

it("keeps the genuine pending Native Promise charged after its original waiter settles and never replays it", async () => {
  const work = original(),
    native = deferred<{ id: string }>(),
    value = { id: "Native-original" };
  const effect = vi.fn(() => native.promise);
  const operation = intents.beginNoteServiceIntent(
    "notes_delete",
    { id: "delete-original", expectedUpdatedAt: 19 },
    work,
  );
  const pending = operation.execute(effect);
  expect(effect).toHaveBeenCalledOnce();
  work(); // Losing the outer observer cannot finish the already accepted child.
  const gate = close();
  let completed = false;
  const capture = gate.capture().then((lease) => {
    completed = true;
    return lease;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(owners.beginNoteWork("new-service-call")).toBeNull();
  native.resolve(value);
  await expect(pending).resolves.toBe(value);
  const lease = await capture;
  expect(
    lease.snapshots.find((row) => row.snapshot.surface === "service-intents")!
      .snapshot.records,
  ).toEqual([]);
  expect(gate.current()).toBe(true);
  expect(effect).toHaveBeenCalledOnce();
  await expect(operation.execute(effect)).rejects.toMatchObject({
    code: "already-executed",
  });
  expect(effect).toHaveBeenCalledOnce();
  lease.release();
});

it("waits actual bookkeeping settlement without carrying ambient authority across await", async () => {
  const work = original(),
    applied = deferred<void>(),
    value = { path: "actual-image-path" };
  const gate = close();
  const pending = intents
    .beginNoteServiceIntent(
      "notes_image_path",
      { asset: "/note-assets/original/image.png" },
      work,
    )
    .execute(
      () => Promise.resolve(value),
      async (result) => {
        expect(result).toBe(value);
        await applied.promise;
        expect(owners.beginNoteWork("new-work-after-await")).toBeNull();
      },
    );
  let done = false;
  const capture = gate.capture().then((lease) => {
    done = true;
    return lease;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  applied.resolve();
  await expect(pending).resolves.toBe(value);
  work();
  const lease = await capture;
  expect(
    lease.snapshots.find((row) => row.snapshot.surface === "service-intents")!
      .snapshot.records,
  ).toEqual([]);
  lease.release();
});

it("preserves Native success and exact request when result bookkeeping fails instead of fabricating rejection", async () => {
  const value = { id: "Native-accepted", body: "original\r\n" },
    work = original();
  const effect = vi.fn(() => Promise.resolve(value));
  const failed = new Error("local cache could not apply the actual result");
  const returned = await intents
    .beginNoteServiceIntent(
      "notes_link_session",
      { id: "original-note", sessionId: "original-link" },
      work,
    )
    .execute(effect, () => {
      throw failed;
    });
  work();
  expect(returned).toBe(value);
  const { lease, records } = await captured();
  expect(records[0]).toMatchObject({
    command: "notes_link_session",
    args: { id: "original-note", sessionId: "original-link" },
    status: "unverified",
    phase: "result-application-unverified",
    error: failed.message,
  });
  expect(effect).toHaveBeenCalledOnce();
  lease.release();
});

it("retains independent uncertain operations without merging or clearing them through another successful call", async () => {
  await fail("notes_upsert", {
    note: { id: "same-note", body: "first original" },
  });
  await fail("notes_upsert", {
    note: { id: "same-note", body: "second original" },
  });
  const work = original();
  const result = await intents
    .beginNoteServiceIntent(
      "notes_discard_recovery_assets",
      { id: "different-original" },
      work,
    )
    .execute(() => Promise.resolve(undefined));
  work();
  expect(result).toBeUndefined();
  const { lease, records } = await captured();
  expect(records.map((row) => row.args.note.body)).toEqual([
    "first original",
    "second original",
  ]);
  expect(new Set(records.map((row) => row.id)).size).toBe(2);
  expect(new Set(records.map((row) => row.callId)).size).toBe(2);
  lease.release();
});

it("runs forged, raw-registry and already-settled work unrecorded instead of refusing it", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fakeApply = vi.fn((callback: () => unknown) => callback());
  const forged = Object.assign(() => {}, { apply: fakeApply }) as NoteInputWork;
  const native = vi.fn(() => Promise.resolve("ran"));
  await expect(
    intents.beginNoteServiceIntent("notes_delete", { id: "forged" }, forged).execute(native),
  ).resolves.toBe("ran");
  expect(fakeApply).not.toHaveBeenCalled();
  const registration = facade.registerNoteInput(
    () => ({ snapshot: { surface: "unrelated" } }),
    { canClose: () => true, close: () => {} },
  );
  const raw = registration.operation("not-a-private-logical-owner")!;
  await intents.beginNoteServiceIntent("notes_delete", { id: "foreign" }, raw).execute(native);
  raw();
  registration.unregister();
  const settled = original();
  settled();
  await intents.beginNoteServiceIntent("notes_delete", { id: "stale" }, settled).execute(native);
  expect(native).toHaveBeenCalledTimes(3);
  const { lease, records } = await captured();
  expect(records).toEqual([]);
  lease.release();
});

it("drops the conserved request when Native definitely rejects", async () => {
  // Tauri rejects with the command's returned error (a string), never an Error.
  const work = original(),
    error = "Native rejected";
  const effect = vi.fn(() => Promise.reject(error));
  await expect(
    intents.beginNoteServiceIntent("notes_upsert", { note: { id: "n" } }, work).execute(effect),
  ).rejects.toBe(error);
  work();
  const { lease, records } = await captured();
  expect(records).toEqual([]);
  lease.release();
});

it("runs unsupported exact requests unrecorded and never invokes a request getter", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const getter = vi.fn(() => "must not read");
  const accessor = Object.defineProperty({}, "body", {
    enumerable: true,
    get: getter,
  });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const args of [
    accessor,
    cyclic,
    { body: "\ud800" },
    { tags: [undefined] },
    { count: Infinity },
  ]) {
    const work = original(),
      native = vi.fn(() => Promise.resolve());
    await intents.beginNoteServiceIntent("notes_upsert", args, work).execute(native);
    expect(native).toHaveBeenCalledOnce();
    work();
  }
  expect(getter).not.toHaveBeenCalled();
  const { lease, records } = await captured();
  expect(records).toEqual([]);
  lease.release();
});

it("evicts the oldest unverified original instead of refusing the 65th", async () => {
  for (
    let index = 0;
    index < intents.NOTE_SERVICE_INTENT_LIMITS.records;
    index++
  )
    await fail("notes_delete", {
      id: `original-${index}`,
      expectedUpdatedAt: index,
    });
  const native = vi.fn(() => Promise.resolve()),
    work = original();
  await intents.beginNoteServiceIntent("notes_delete", { id: "new-admitted" }, work).execute(native);
  work();
  expect(native).toHaveBeenCalledOnce();
  const { lease, records } = await captured();
  expect(records.map((row) => row.args.id)).toEqual(
    Array.from({ length: 63 }, (_, index) => `original-${index + 1}`),
  );
  lease.release();
});

it("charges pending requests against the shared8MiB budget, evicts unknown ones first, and runs the overflow unrecorded", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const body = "x".repeat(2 * 1024 * 1024);
  await fail("notes_upsert", { note: { id: "large-original-unknown", body } });
  const io = [deferred<void>(), deferred<void>(), deferred<void>()];
  const pending = io.map((actual, index) => {
    const work = original();
    const result = intents
      .beginNoteServiceIntent(
        "notes_upsert",
        { note: { id: `large-pending-${index}`, body } },
        work,
      )
      .execute(() => actual.promise);
    work();
    return result;
  });
  const work = original(),
    native = vi.fn(() => Promise.resolve());
  await intents
    .beginNoteServiceIntent("notes_upsert", { note: { id: "large-overflow", body } }, work)
    .execute(native);
  work();
  expect(native).toHaveBeenCalledOnce();
  const gate = close();
  let completed = false;
  const capture = gate.capture().then((lease) => {
    completed = true;
    return lease;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  io.forEach((actual) => actual.resolve());
  await Promise.all(pending);
  (await capture).release();
  const { lease, records, service } = await captured();
  expect(records).toEqual([]);
  expect(service.snapshot.retainedBytes).toBeLessThanOrEqual(
    intents.NOTE_SERVICE_INTENT_LIMITS.bytes,
  );
  lease.release();
}, 30_000);

it("keeps a synchronous Native invocation failure unverified without retrying", async () => {
  const work = original(),
    error = new Error("actual invoke boundary threw");
  const effect = vi.fn(() => {
    throw error;
  });
  const operation = intents.beginNoteServiceIntent(
    "notes_delete",
    { id: "original-synchronous", expectedUpdatedAt: 8 },
    work,
  );
  await expect(operation.execute(effect)).rejects.toBe(error);
  work();
  await expect(operation.execute(effect)).rejects.toMatchObject({
    code: "already-executed",
  });
  expect(effect).toHaveBeenCalledOnce();
  const { lease, records } = await captured();
  // A thrown Error does not prove the effect did not happen: the original stays conserved.
  expect(records).toEqual([
    expect.objectContaining({
      command: "notes_delete",
      status: "unverified",
      phase: "native-outcome-unverified",
    }),
  ]);
  lease.release();
});

it("bounds unverified diagnostics without reading error accessors or changing the original rejection", async () => {
  const message = "ç 😀 ".repeat(1000);
  await fail(
    "notes_save_image",
    { noteId: "original", sourcePath: "/original/image.png" },
    new Error(message),
  );
  const get = vi.fn(() => "private getter"),
    error = Object.defineProperty({}, "message", { get });
  await fail("notes_discard_recovery_assets", { id: "original-copy" }, error);
  expect(get).not.toHaveBeenCalled();
  const { lease, records } = await captured();
  expect(
    new TextEncoder().encode(records[0].error).byteLength,
  ).toBeLessThanOrEqual(512);
  expect(records[1].error).toBe("Native request outcome could not be verified");
  lease.release();
});

it("retains unknown data through an actual module/facade reload and runs exhausted identities unrecorded", async () => {
  await fail("notes_upsert", {
    note: {
      id: "reload-original",
      body: "\r\n retained 😀",
      optional: undefined,
    },
  });
  const before = await captured();
  owners.noteActivityOwner().retire();
  vi.resetModules();
  facade = await import("./notesInputClosure");
  owners = await import("./notesInputOwners");
  intents = await import("./noteServiceIntents");
  expect(before.lease.current()).toBe(false);
  before.lease.release();
  const after = await captured();
  expect(after.records).toEqual(before.records);
  after.lease.release();
  const keeper = (globalThis as Record<PropertyKey, any>)[
    Symbol.for("bycoda.note-service-intents.v1")
  ];
  keeper.nextId = Number.MAX_SAFE_INTEGER;
  const native = vi.fn(() => Promise.resolve()),
    work = original();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await intents
    .beginNoteServiceIntent("notes_delete", { id: "no-new-identity" }, work)
    .execute(native);
  work();
  expect(native).toHaveBeenCalledOnce();
  const preserved = await captured();
  expect(preserved.records).toEqual(before.records);
  preserved.lease.release();
});
