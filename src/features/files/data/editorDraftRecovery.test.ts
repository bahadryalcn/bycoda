import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorDraftRecovery, type EditorDraftRecoverySource } from "./editorDraftRecovery";
import {
  createEditorDraftPersistence,
  EditorDraftPersistenceError,
  type NativeEditorDraftRecord,
} from "./editorDraftPersistence";
import { PersistenceDrainRegistry } from "../../sessions/data/persistenceDrain";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const size = (value: string) => Buffer.byteLength(value, "utf8");
const store = "11111111-1111-4111-8111-111111111111";
const oldWindow = "22222222-2222-4222-8222-222222222222";
const currentWindow = "33333333-3333-4333-8333-333333333333";
const nextWindow = "44444444-4444-4444-8444-444444444444";
const targetId = "55555555-5555-4555-8555-555555555555";
const targetId2 = "66666666-6666-4666-8666-666666666666";
const owner = (window: string) => hash(`${store}:${window}`);
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function record(
  documentId: string,
  text = "\uFEFF漢🦀\nnew\u2028\u2029\u0000",
  window = oldWindow,
  revision = 3,
): NativeEditorDraftRecord {
  const payload = {
    documentId,
    path: "C:\\fixture\\native-file.txt",
    text,
    eol: "crlf" as const,
    diskBaseline: "\uFEFForiginal\r\n",
    revision,
  };
  const raw = JSON.stringify(payload);
  return {
    payload,
    metadata: {
      ownerId: owner(window),
      storeInstance: store,
      windowIncarnation: window,
      windowLabel: "fixture-main",
      documentId,
      path: payload.path,
      revision,
      payloadDigest: hash(raw),
      textDigest: hash(text),
      serializedTextDigest: hash(text.replace(/\n/g, "\r\n")),
      baselineDigest: hash(payload.diskBaseline),
      retainedBytes: size(raw) + size(documentId + payload.path + "fixture-main") + 512,
      state: "retained",
      saveAckId: null,
      updatedAt: 1,
    },
  };
}
function locator(value: NativeEditorDraftRecord): EditorDraftRecoverySource {
  const { ownerId, documentId, revision, payloadDigest } = value.metadata;
  return { ownerId, documentId, revision, payloadDigest };
}
function fixture(
  options: {
    timeoutMs?: number;
    available?: () => boolean;
    wrapPersistence?: (
      value: ReturnType<typeof createEditorDraftPersistence>,
    ) => Pick<ReturnType<typeof createEditorDraftPersistence>, "bindDocument">;
  } = {},
) {
  const source = record("source-document");
  const rows = new Map([[`${source.metadata.ownerId}:${source.payload.documentId}`, source]]);
  let epoch = owner(currentWindow);
  let window = currentWindow;
  let lostAcks = 0;
  let heldPut: ReturnType<typeof deferred> | undefined;
  let heldRead: ReturnType<typeof deferred> | undefined;
  let heldInventory: ReturnType<typeof deferred> | undefined;
  let failedCurrentReads = 0;
  let transform: (value: any) => any = (value) => value;
  let afterRead = () => {};
  const calls: Array<{ command: string; args?: Record<string, any> }> = [];
  async function invoke<T>(command: string, args?: Record<string, any>): Promise<T> {
    calls.push({ command, args: structuredClone(args) });
    if (command === "native_editor_draft_open")
      return { version: 1, qualified: false, ownerEpoch: epoch } as T;
    if (command === "native_editor_draft_inventory") {
      if (heldInventory) await heldInventory.promise;
      const { after, limit } = args!.request;
      const records = [...rows.values()]
        .map((row) => row.metadata)
        .sort((a, b) =>
          a.ownerId < b.ownerId
            ? -1
            : a.ownerId > b.ownerId
              ? 1
              : a.documentId < b.documentId
                ? -1
                : 1,
        )
        .filter(
          (m) =>
            !after ||
            m.ownerId > after.ownerId ||
            (m.ownerId === after.ownerId && m.documentId > after.documentId),
        );
      const page = records.slice(0, limit);
      return transform({
        version: 1,
        qualified: false,
        records: structuredClone(page),
        next:
          records.length > limit
            ? { ownerId: page.at(-1)!.ownerId, documentId: page.at(-1)!.documentId }
            : null,
      }) as T;
    }
    const request = args?.request ?? args?.document ?? args?.capture;
    if (request.ownerEpoch !== epoch) throw new Error("NATIVE_EDITOR_DRAFT_OWNER_CHANGED");
    if (command === "native_editor_draft_read_recovery") {
      if (heldRead) await heldRead.promise;
      if (request.ownerEpoch !== epoch) throw new Error("NATIVE_EDITOR_DRAFT_OWNER_CHANGED");
      const { source } = request;
      const found = rows.get(`${source.ownerId}:${source.documentId}`);
      if (
        !found ||
        found.metadata.revision !== source.revision ||
        found.metadata.payloadDigest !== source.payloadDigest
      )
        throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
      const response = transform({ version: 1, qualified: false, record: structuredClone(found) });
      afterRead();
      return response as T;
    }
    if (command === "native_editor_draft_read_current") {
      if (failedCurrentReads > 0) {
        failedCurrentReads--;
        throw new Error("current read unavailable");
      }
      return {
        version: 1,
        qualified: false,
        record: structuredClone(rows.get(`${epoch}:${request.documentId}`) ?? null),
      } as T;
    }
    if (command === "native_editor_draft_put") {
      if (heldPut) {
        const held = heldPut;
        heldPut = undefined;
        await held.promise;
      }
      if (request.ownerEpoch !== epoch) throw new Error("NATIVE_EDITOR_DRAFT_OWNER_CHANGED");
      const { ownerEpoch: _owner, expectedRevision, ...payload } = request;
      const key = `${epoch}:${payload.documentId}`;
      const previous = rows.get(key);
      if (previous) {
        if (
          previous.metadata.revision !== expectedRevision ||
          payload.revision <= previous.metadata.revision
        )
          throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
      } else if (expectedRevision !== null)
        throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
      const value = record(payload.documentId, payload.text, window, payload.revision);
      value.payload = payload;
      value.metadata = {
        ...value.metadata,
        path: payload.path,
        payloadDigest: hash(JSON.stringify(payload)),
        baselineDigest: hash(payload.diskBaseline),
        retainedBytes:
          size(JSON.stringify(payload)) +
          size(payload.documentId + payload.path + value.metadata.windowLabel) +
          512,
        serializedTextDigest: hash(
          payload.serializedText ??
            payload.text.replace(
              /\n/g,
              payload.eol === "crlf" ? "\r\n" : payload.eol === "cr" ? "\r" : "\n",
            ),
        ),
      };
      rows.set(key, value);
      if (lostAcks-- > 0) throw new Error("lost Native put ACK");
      return { version: 1, qualified: false, record: structuredClone(value.metadata) } as T;
    }
    throw new Error(`Unexpected command ${command}`);
  }
  const persistence = createEditorDraftPersistence({
    invoke,
    available: () => true,
    registry: new PersistenceDrainRegistry(),
    debounceMs: 1000,
  });
  const api = createEditorDraftRecovery({
    invoke,
    persistence: options.wrapPersistence?.(persistence) ?? persistence,
    available: options.available ?? (() => true),
    timeoutMs: options.timeoutMs ?? 1000,
  });
  return {
    ...api,
    invoke,
    persistence,
    source,
    rows,
    calls,
    locator: locator(source),
    puts: () => calls.filter((call) => call.command === "native_editor_draft_put"),
    transform(value: typeof transform) {
      transform = value;
    },
    changeOwner() {
      window = nextWindow;
      epoch = owner(window);
    },
    afterRead(callback: () => void) {
      afterRead = callback;
    },
    loseAcks(count = 1) {
      lostAcks = count;
    },
    failCurrentReads(count = 1) {
      failedCurrentReads = count;
    },
    holdPut() {
      return (heldPut = deferred());
    },
    holdRead() {
      return (heldRead = deferred());
    },
    holdInventory() {
      return (heldInventory = deferred());
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});

describe("local Native editor recovery catalog and copy", () => {
  it("paginates exact bounded metadata in native cursor order and never returns content", async () => {
    const f = fixture();
    const second = record("source-z");
    f.rows.set(`${second.metadata.ownerId}:source-z`, second);
    const first = await f.listEditorDraftRecovery({ after: null, limit: 1 });
    expect(first).toMatchObject({
      version: 1,
      qualified: false,
      records: [{ documentId: "source-document" }],
      next: { documentId: "source-document" },
    });
    expect(first.records[0]).not.toHaveProperty("payload");
    const next = await f.listEditorDraftRecovery({ after: first.next, limit: 1 });
    expect(next.records.map((row) => row.documentId)).toEqual(["source-z"]);
    expect(next.next).toBeNull();
    expect(Object.isFrozen(first.records[0])).toBe(true);
    expect(f.calls.every((call) => call.command === "native_editor_draft_inventory")).toBe(true);
  });

  it.each([
    { after: null, limit: 0 },
    { after: null, limit: 101 },
    { after: null, limit: 1.1 },
    { after: { ownerId: "bad", documentId: "x" }, limit: 1 },
    { after: null, limit: 1, path: "forged" },
  ])("rejects invalid catalog admission before IPC: %j", async (input) => {
    const f = fixture();
    await expect(f.listEditorDraftRecovery(input as any)).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(f.calls).toHaveLength(0);
  });

  it.each(["duplicate", "cursor", "oversized", "owner", "extra"])(
    "rejects a malformed metadata page (%s)",
    async (mode) => {
      const f = fixture();
      f.transform((value) => {
        if (mode === "duplicate") value.records.push(value.records[0]);
        if (mode === "cursor") value.next = { ownerId: owner(oldWindow), documentId: "different" };
        if (mode === "oversized") value.records[0].path = "C:\\" + "a".repeat(4096);
        if (mode === "owner") value.records[0].ownerId = "a".repeat(64);
        if (mode === "extra") value.records[0].payload = "content";
        return value;
      });
      await expect(f.listEditorDraftRecovery({ after: null, limit: 2 })).rejects.toMatchObject({
        code: "invalid-response",
      });
    },
  );

  it("reads the exact source with Unicode/BOM/raw baseline and all Native digest checks", async () => {
    const f = fixture();
    const value = await f.readEditorDraftRecovery(f.locator);
    expect(value).toEqual(f.source);
    expect(Object.isFrozen(value.payload)).toBe(true);
    expect(f.calls[1]).toEqual({
      command: "native_editor_draft_read_recovery",
      args: { request: { ownerEpoch: owner(currentWindow), source: f.locator } },
    });
    expect(f.puts()).toHaveLength(0);
  });

  it.each(["missing", "changed", "foreign-profile"])(
    "does not substitute another recovery source when %s",
    async (mode) => {
      const f = fixture();
      const source = { ...f.locator };
      if (mode === "missing") f.rows.clear();
      if (mode === "changed") source.revision++;
      if (mode === "foreign-profile") source.ownerId = "f".repeat(64);
      await expect(f.prepareEditorDraftRestore(source, { documentId: targetId })).rejects.toThrow(
        "REVISION_CONFLICT",
      );
      expect(f.puts()).toHaveLength(0);
    },
  );

  it("restores an exact mixed-separator native draft and rejects tampered bytes", async () => {
    const f = fixture();
    const base = record("mixed", "a\nb\nc\n");
    const payload = {
      documentId: base.payload.documentId,
      path: base.payload.path,
      text: base.payload.text,
      eol: base.payload.eol,
      serializedText: "a\r\nb\nc\r",
      diskBaseline: base.payload.diskBaseline,
      revision: base.payload.revision,
    };
    const raw = JSON.stringify(payload);
    const mixed = {
      payload,
      metadata: {
        ...base.metadata,
        payloadDigest: hash(raw),
        serializedTextDigest: hash(payload.serializedText),
        retainedBytes:
          size(raw) + size(payload.documentId + payload.path + base.metadata.windowLabel) + 512,
      },
    };
    f.rows.set(`${mixed.metadata.ownerId}:mixed`, mixed);
    const source = locator(mixed);
    const read = await f.readEditorDraftRecovery(source);
    expect(read.payload.serializedText).toBe(payload.serializedText);
    const prepared = await f.prepareEditorDraftRestore(source, { documentId: targetId });
    expect(prepared.payload.serializedText).toBe(payload.serializedText);
    f.rows.set(`${mixed.metadata.ownerId}:mixed`, {
      ...mixed,
      payload: { ...payload, serializedText: "wrong\r\n" },
    });
    await expect(f.readEditorDraftRecovery(source)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it.each([
    "text",
    "baseline",
    "eol",
    "path",
    "revision",
    "owner",
    "bytes",
    "qualified",
    "surrogate",
    "extra",
  ])("rejects corrupted or mismatched disclosed payload (%s)", async (mode) => {
    const f = fixture();
    f.transform((value) => {
      if (mode === "qualified") value.qualified = true;
      else if (mode === "owner") value.record.metadata.ownerId = "b".repeat(64);
      else if (mode === "bytes") value.record.metadata.retainedBytes++;
      else if (mode === "surrogate") value.record.payload.text = "\ud800";
      else if (mode === "extra") value.record.payload.arbitrary = true;
      else if (mode === "revision") value.record.payload.revision++;
      else
        value.record.payload[mode === "baseline" ? "diskBaseline" : mode] =
          mode === "eol" ? "lf" : "tampered";
      return value;
    });
    await expect(f.readEditorDraftRecovery(f.locator)).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(f.puts()).toHaveLength(0);
  });

  it("prepares one fresh exact Native copy and leaves original/current-owner data and disk alone", async () => {
    const f = fixture();
    const original = structuredClone(f.source);
    const prepared = await f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    expect(prepared).toMatchObject({
      version: 1,
      qualified: false,
      source: f.locator,
      target: {
        ownerEpoch: owner(currentWindow),
        documentId: targetId,
        path: original.payload.path,
        revision: 1,
      },
      payload: {
        text: original.payload.text,
        diskBaseline: original.payload.diskBaseline,
        eol: original.payload.eol,
      },
    });
    expect(f.puts()).toHaveLength(1);
    expect(f.rows.get(`${f.source.metadata.ownerId}:source-document`)).toEqual(original);
    expect(await f.prepareEditorDraftRestore(f.locator, { documentId: targetId })).toBe(prepared);
    expect(f.puts()).toHaveLength(1);
    expect(Object.isFrozen(prepared.target)).toBe(true);
    expect(f.calls.some((call) => /save|clear|delete|write_file/.test(call.command))).toBe(false);
    expect(f.persistence.observation().jobs).toBe(0);
  });

  it("rejects an occupied target UUID and never replaces its current draft", async () => {
    const f = fixture();
    const existing = record(targetId, "existing current owner", currentWindow, 7);
    f.rows.set(`${owner(currentWindow)}:${targetId}`, existing);
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
    ).rejects.toMatchObject({ code: "target-conflict" });
    expect(f.puts()).toHaveLength(0);
    expect(f.rows.get(`${owner(currentWindow)}:${targetId}`)).toEqual(existing);
  });

  it("does not coalesce another binding's accepted unsaved capture into a supposedly fresh recovery target", async () => {
    const f = fixture();
    const existing = f.persistence.bindDocument({
      documentId: targetId,
      path: f.source.payload.path,
      origin: "local-native",
    });
    await existing.ready;
    const ticket = existing.capture({
      captureId: "already accepted editor",
      text: "current unsaved data",
      diskBaseline: "disk",
      eol: "lf",
    });
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
    ).rejects.toMatchObject({ code: "target-conflict" });
    // Recovery disposal wakes the already-owned document lane; it preserves its
    // actual original payload rather than substituting the recovery source.
    await existing.flush();
    await ticket.persisted;
    expect(f.rows.get(`${owner(currentWindow)}:${targetId}`)?.payload.text).toBe(
      "current unsaved data",
    );
    expect(f.puts()).toHaveLength(1);
    existing.dispose();
  });

  it("reconciles a lost target ACK with the same owner/document receipt without another put or target ID", async () => {
    const f = fixture();
    f.loseAcks();
    const result = await f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    expect(result.target.documentId).toBe(targetId);
    expect(f.puts()).toHaveLength(1);
    expect(
      f.calls.filter((call) => call.command === "native_editor_draft_read_current"),
    ).toHaveLength(2);
    expect(f.rows.size).toBe(2);
  });

  it("retains the exact target across failed reconciliation and uses a fresh binding lease for an explicit retry", async () => {
    const f = fixture();
    const held = f.holdPut();
    f.loseAcks();
    const first = f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    const rejected = expect(first).rejects.toThrow("current read unavailable");
    await vi.waitFor(() => expect(f.puts()).toHaveLength(1));
    f.failCurrentReads();
    held.resolve();
    await rejected;
    expect(f.observation().active).toBe(0);
    const result = await f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    expect(result.target.documentId).toBe(targetId);
    expect(f.puts()).toHaveLength(1);
    expect(f.rows.size).toBe(2);
  });

  it("can retry the same UUID after a definitely unadmitted capture ticket when capacity recovers", async () => {
    let full = true;
    // Faithful manager-port fixture: snapshot-capacity rejection returns a
    // rejected ticket, no latest capture and no job; it does not throw capture.
    const f = fixture({
      wrapPersistence: (manager) => ({
        bindDocument(input) {
          const actual = manager.bindDocument(input);
          let rejected = false;
          const failure = new EditorDraftPersistenceError("capacity");
          return {
            ...actual,
            capture(value) {
              if (!full) return actual.capture(value);
              rejected = true;
              return {
                ...value,
                documentId: input.documentId,
                path: input.path,
                persisted: Promise.reject(failure),
              };
            },
            observe() {
              return rejected
                ? { ...actual.observe(), phase: "error", error: failure }
                : actual.observe();
            },
          };
        },
      }),
    });
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
    ).rejects.toMatchObject({ code: "capacity" });
    expect(f.puts()).toHaveLength(0);
    full = false;
    const result = await f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    expect(result.target.documentId).toBe(targetId);
    expect(f.puts()).toHaveLength(1);
  });

  it("joins concurrent requests for the same target and bounds their waiter reactions", async () => {
    const f = fixture();
    const held = f.holdRead();
    const waiting = Array.from({ length: 32 }, () =>
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
    );
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
    ).rejects.toMatchObject({ code: "capacity" });
    expect(f.observation()).toMatchObject({ active: 1, waiters: 32, preparations: 1 });
    held.resolve();
    const values = await Promise.all(waiting);
    expect(values.every((value) => value === values[0])).toBe(true);
    expect(f.puts()).toHaveLength(1);
    expect(f.observation()).toMatchObject({ active: 0, waiters: 0 });
  });

  it("does not rebind the source's accepted read to a changed physical owner before target admission", async () => {
    const f = fixture();
    f.afterRead(() => f.changeOwner());
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
    ).rejects.toMatchObject({ code: "stale-owner" });
    expect(f.puts()).toHaveLength(0);
  });

  it("keeps target work and budgets through waiter timeout, then joins the same actual prepared result", async () => {
    const f = fixture({ timeoutMs: 100 });
    const held = f.holdPut();
    const request = f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    const rejected = expect(request).rejects.toMatchObject({ code: "deadline" });
    await vi.waitFor(() => expect(f.puts()).toHaveLength(1));
    await rejected;
    expect(f.puts()).toHaveLength(1);
    expect(f.observation()).toMatchObject({ active: 1, waiters: 1, preparations: 1 });
    const retry = f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    held.resolve();
    const result = await retry;
    expect(result.target.documentId).toBe(targetId);
    expect(f.puts()).toHaveLength(1);
    expect(f.observation()).toMatchObject({ active: 0, waiters: 0 });
  });

  it("bounds actual IPC lifetimes after all waiters leave", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 10 });
    const held = f.holdInventory();
    const pending = Array.from({ length: 8 }, () =>
      f.listEditorDraftRecovery({ after: null, limit: 1 }),
    );
    const failures = pending.map((value) =>
      expect(value).rejects.toMatchObject({ code: "deadline" }),
    );
    await expect(f.listEditorDraftRecovery({ after: null, limit: 1 })).rejects.toMatchObject({
      code: "capacity",
    });
    await vi.advanceTimersByTimeAsync(15);
    await Promise.all(failures);
    expect(f.observation()).toMatchObject({ active: 8, waiters: 8 });
    held.resolve();
    await vi.waitFor(() => expect(f.observation().active).toBe(0));
  });

  it("keeps timed-out waiter subscriptions charged until the same held preparation actually settles", async () => {
    const f = fixture({ timeoutMs: 1 });
    const held = f.holdRead();
    for (let n = 0; n < 32; n++) {
      await expect(
        f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
      ).rejects.toMatchObject({ code: "deadline" });
      expect(f.observation()).toMatchObject({ active: 1, waiters: n + 1, preparations: 1 });
    }
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId }),
    ).rejects.toMatchObject({ code: "capacity" });
    const calls = f.calls.length;
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId2 }),
    ).rejects.toMatchObject({ code: "capacity" });
    await expect(f.listEditorDraftRecovery({ after: null, limit: 1 })).rejects.toMatchObject({
      code: "capacity",
    });
    await expect(f.readEditorDraftRecovery(f.locator)).rejects.toMatchObject({ code: "capacity" });
    expect(f.calls).toHaveLength(calls);
    expect(f.observation().preparations).toBe(1);
    held.resolve();
    await vi.waitFor(() => expect(f.observation()).toMatchObject({ active: 0, waiters: 0 }));
    const result = await f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    expect(result.target.documentId).toBe(targetId);
    expect(f.puts()).toHaveLength(1);
  });

  it("rejects retargeting an already owned UUID to another source before disclosure or mutation", async () => {
    const f = fixture();
    await f.prepareEditorDraftRestore(f.locator, { documentId: targetId });
    const calls = f.calls.length;
    await expect(
      f.prepareEditorDraftRestore({ ...f.locator, revision: 4 }, { documentId: targetId }),
    ).rejects.toMatchObject({ code: "target-conflict" });
    expect(f.calls).toHaveLength(calls);
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: "not-a-uuid" }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(f.puts()).toHaveLength(1);
  });

  it("never uses Native or selected Host routing when unavailable", async () => {
    const f = fixture({ available: () => false });
    await expect(f.listEditorDraftRecovery({ after: null, limit: 1 })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(f.readEditorDraftRecovery(f.locator)).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(
      f.prepareEditorDraftRestore(f.locator, { documentId: targetId2 }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.calls).toHaveLength(0);
  });
});
