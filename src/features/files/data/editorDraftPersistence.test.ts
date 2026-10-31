import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Text } from "@codemirror/state";
import {
  createEditorDraftPersistence,
  bindEditorDraftDocument,
  type EditorDraftCaptureInput,
  type NativeEditorDraftRecord,
} from "./editorDraftPersistence";
import { PersistenceDrainRegistry } from "../../sessions/data/persistenceDrain";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => tauri);
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const input = (
  text: EditorDraftCaptureInput["text"],
  captureId = "capture",
): EditorDraftCaptureInput => ({ text, captureId, diskBaseline: "disk\r\nbaseline", eol: "crlf" });
function nativeFixture() {
  let epoch = "a".repeat(64);
  let row: NativeEditorDraftRecord | null = null;
  let failPutAfterCommit = false;
  let failSaveAfterCommit = false;
  let failRead = false;
  let holdPut: ReturnType<typeof deferred> | undefined;
  let holdSave: ReturnType<typeof deferred> | undefined;
  const calls: string[] = [];
  const putPayloads: any[] = [];
  const savePayloads: any[] = [];
  function metadata(payload: any) {
    return {
      ownerId: epoch,
      storeInstance: "store",
      windowIncarnation: "window",
      windowLabel: "main",
      documentId: payload.documentId,
      path: payload.path,
      revision: payload.revision,
      payloadDigest: hash(JSON.stringify(payload)),
      textDigest: hash(payload.text),
      serializedTextDigest: hash(
        payload.eol === "lf"
          ? payload.text
          : payload.text.replace(/\n/g, payload.eol === "crlf" ? "\r\n" : "\r"),
      ),
      baselineDigest: hash(payload.diskBaseline),
      retainedBytes: 1024,
      state: "retained" as const,
      saveAckId: null,
      updatedAt: 1,
    };
  }
  async function invoke<T>(command: string, args?: Record<string, any>): Promise<T> {
    calls.push(command);
    if (command === "native_editor_draft_open")
      return { version: 1, qualified: false, ownerEpoch: epoch } as T;
    const request = args?.document ?? args?.capture ?? args?.saved;
    if (request.ownerEpoch !== epoch) throw "NATIVE_EDITOR_DRAFT_OWNER_CHANGED";
    if (command === "native_editor_draft_read_current") {
      if (failRead) {
        failRead = false;
        throw new Error("read unavailable");
      }
      return { version: 1, qualified: false, record: structuredClone(row) } as T;
    }
    if (command === "native_editor_draft_put") {
      putPayloads.push(structuredClone(request));
      if (holdPut) {
        const held = holdPut;
        holdPut = undefined;
        await held.promise;
      }
      const { ownerEpoch: _owner, expectedRevision, ...payload } = request;
      if (row && row.metadata.revision === payload.revision) {
        if (JSON.stringify(row.payload) !== JSON.stringify(payload))
          throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
      } else {
        if (
          (row?.metadata.revision ?? null) !== expectedRevision ||
          payload.revision <= (row?.metadata.revision ?? 0)
        )
          throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
        row = { payload, metadata: metadata(payload) };
      }
      if (failPutAfterCommit) {
        failPutAfterCommit = false;
        throw new Error("lost put ACK");
      }
      return { version: 1, qualified: false, record: structuredClone(row.metadata) } as T;
    }
    if (command === "native_editor_draft_clear_saved") {
      savePayloads.push(structuredClone(request));
      if (holdSave) {
        const held = holdSave;
        holdSave = undefined;
        await held.promise;
      }
      if (
        !row ||
        row.metadata.revision !== request.revision ||
        row.metadata.payloadDigest !== request.payloadDigest ||
        row.metadata.serializedTextDigest !== request.savedTextDigest
      )
        throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
      row = {
        ...row,
        metadata: {
          ...row.metadata,
          state: "save-reported",
          saveAckId: row.metadata.saveAckId ?? "saved-ack",
        },
      };
      if (failSaveAfterCommit) {
        failSaveAfterCommit = false;
        throw new Error("lost saved ACK");
      }
      return { version: 1, qualified: false, record: structuredClone(row.metadata) } as T;
    }
    throw new Error("Unexpected native command");
  }
  const registry = new PersistenceDrainRegistry();
  const manager = createEditorDraftPersistence({
    invoke,
    available: () => true,
    registry,
    debounceMs: 100,
    operationTimeoutMs: 50,
  });
  const doc = manager.bindDocument({
    documentId: "doc",
    path: "/fixture/file.txt",
    origin: "local-native",
  });
  return {
    manager,
    doc,
    registry,
    calls,
    putPayloads,
    savePayloads,
    invoke,
    get row() {
      return row;
    },
    get epoch() {
      return epoch;
    },
    changeOwner() {
      epoch = "b".repeat(64);
    },
    losePutAck() {
      failPutAfterCommit = true;
    },
    loseSaveAck() {
      failSaveAfterCommit = true;
    },
    failRead() {
      failRead = true;
    },
    holdPut() {
      return (holdPut = deferred());
    },
    holdSave() {
      return (holdSave = deferred());
    },
    externalAdvance(text: string) {
      if (!row) throw new Error("Missing fixture row");
      const payload = { ...row.payload, text, revision: row.metadata.revision + 1 };
      row = { payload, metadata: metadata(payload) };
    },
    seed() {
      const payload = {
        documentId: "doc",
        path: "/fixture/file.txt",
        text: "restorable",
        eol: "lf",
        diskBaseline: "old disk",
        revision: 7,
      };
      row = { payload, metadata: metadata(payload) };
    },
  };
}
const attempts: Array<{ abandon(): void }> = [];
afterEach(() => {
  attempts.splice(0).forEach((attempt) => attempt.abandon());
  tauri.isTauri.mockReturnValue(false);
  vi.useRealTimers();
});

describe("Native editor full capture ownership", () => {
  it("admits the actual immutable CodeMirror document before debounce and materializes only the coalesced latest snapshot", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const first = f.doc.capture(input(Text.of(["old"]), "one"));
    const rope = Text.of(["İstanbul 🍏", "", "Ω"]);
    const toString = vi.spyOn(rope, "toString");
    const latest = f.doc.capture(input(rope, "two"));
    expect(toString).not.toHaveBeenCalled();
    expect(f.doc.observe().pending).toBe(true);
    expect(f.putPayloads).toHaveLength(0);
    await f.doc.flush();
    expect(toString).toHaveBeenCalledOnce();
    expect(f.putPayloads).toHaveLength(1);
    expect(f.row?.payload.text).toBe("İstanbul 🍏\n\nΩ");
    expect(f.row?.payload.diskBaseline).toBe("disk\r\nbaseline");
    expect((await first.persisted).coveredByCaptureId).toBe("two");
    expect((await latest.persisted).record.ownerId).toBe(f.epoch);
    expect(Object.isFrozen(latest)).toBe(true);
  });

  it("retains empty full drafts and EOL digests instead of treating empty as deletion", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const first = f.doc.capture(input("a\n🍏", "unicode"));
    await f.doc.flush();
    expect((await first.persisted).record.serializedTextDigest).toBe(hash("a\r\n🍏"));
    const empty = f.doc.capture({ ...input("", "empty"), eol: "cr" });
    await f.doc.flush();
    expect(f.row?.payload.text).toBe("");
    expect((await empty.persisted).record.revision).toBe(2);
    expect(f.row?.metadata.state).toBe("retained");
  });

  it("preserves leading BOM, JSON controls and line separators accepted by Native UTF8 strings", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const text = '\uFEFF漢🦀\nnew\u2028\u2029\u0000\b\t\f\\"';
    const ticket = f.doc.capture({ ...input(text), diskBaseline: "\uFEFForiginal\r\n" });
    await f.doc.flush();
    expect(f.row?.payload.text).toBe(text);
    expect((await ticket.persisted).record.serializedTextDigest).toBe(
      hash(text.replace(/\n/g, "\r\n")),
    );
    expect(f.row?.payload.diskBaseline).toBe("\uFEFForiginal\r\n");
  });

  it("does not overwrite an existing restorable draft during initialization or consume queued edits by a decision alone", async () => {
    const f = nativeFixture();
    f.seed();
    const before = f.doc.capture(input("new local edits"));
    const ready = await f.doc.ready;
    expect(ready.currentDraft?.payload.text).toBe("restorable");
    expect(ready.initializationDecisionRequired).toBe(true);
    await expect(f.doc.flush()).rejects.toMatchObject({ code: "initialization-required" });
    await expect(before.persisted).rejects.toMatchObject({ code: "initialization-required" });
    expect(f.putPayloads).toHaveLength(0);
    f.doc.resolveInitialization({
      decision: "restore",
      revision: 7,
      payloadDigest: ready.currentDraft!.metadata.payloadDigest,
    });
    expect(f.putPayloads).toHaveLength(0);
    expect(f.doc.observe().captureId).toBe("capture");
    const restored = f.doc.capture(input("restorable", "explicit-restored-document"));
    await f.doc.flush();
    expect((await restored.persisted).record.revision).toBe(8);
    expect(f.row?.payload.text).toBe("restorable");
  });

  it("keeps one pending full snapshot while an actual older Native operation is blocked", async () => {
    vi.useFakeTimers();
    const f = nativeFixture();
    await f.doc.ready;
    const held = f.holdPut();
    f.doc.capture(input("active", "active"));
    const flush = f.doc.flush();
    void flush.catch(() => {});
    await vi.waitFor(() => expect(f.putPayloads).toHaveLength(1));
    for (let n = 0; n < 15; n++) {
      f.doc.capture(input(`latest-${n}`, `edit-${n}`));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(f.putPayloads).toHaveLength(1);
    held.resolve();
    await flush;
    await f.doc.flush();
    expect(f.putPayloads).toHaveLength(2);
    expect(f.row?.payload.text).toBe("latest-14");
  });

  it("debounces continuous edits, bounded by the max wait, and skips unchanged-view emits", async () => {
    vi.useFakeTimers();
    const f = nativeFixture();
    await f.doc.ready;
    const listener = vi.fn();
    f.doc.subscribe(listener);
    // Each edit lands inside the 100 ms window, so only max wait (5 s) can fire it.
    for (let n = 0; n < 40; n++) {
      f.doc.capture(input(`edit-${n}`, `id-${n}`));
      await vi.advanceTimersByTimeAsync(90);
    }
    expect(f.putPayloads).toHaveLength(0);
    // Initial snapshot plus the single ready -> queued transition, not one per edit.
    expect(listener.mock.calls.length).toBeLessThanOrEqual(2);
    expect(f.doc.observe().captureId).toBe("id-39");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.putPayloads).toHaveLength(1);
    await f.doc.flush();
    expect(f.row?.payload.text).toBe("edit-39");
  });

  it("times out a waiter without releasing actual Native work, then accepts only the exact late ACK", async () => {
    vi.useFakeTimers();
    const f = nativeFixture();
    await f.doc.ready;
    const held = f.holdPut();
    const ticket = f.doc.capture(input("held"));
    const waiting = f.doc.flush({ timeoutMs: 10 });
    const rejected = expect(waiting).rejects.toMatchObject({ code: "deadline" });
    await vi.advanceTimersByTimeAsync(60);
    await rejected;
    expect(f.doc.observe()).toMatchObject({ phase: "unknown", pending: true });
    held.resolve();
    await ticket.persisted;
    await f.doc.flush();
    expect(f.doc.observe()).toMatchObject({ phase: "retained", pending: false, qualified: false });
  });

  it("reconciles a lost put ACK by exact read and never replays the put or any filesystem save", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    f.losePutAck();
    const ticket = f.doc.capture(input("retained despite lost ACK"));
    await expect(f.doc.flush()).rejects.toThrow("lost put ACK");
    await expect(ticket.persisted).rejects.toThrow();
    expect(f.doc.observe().error).toBeDefined();
    await f.doc.retry();
    expect(f.putPayloads).toHaveLength(1);
    expect(f.calls.filter((call) => call === "native_editor_draft_read_current")).toHaveLength(2);
    expect(f.doc.observe().error).toBeUndefined();
  });

  it("clears sticky failure only after a newer full same-owner/document ACK", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    f.losePutAck();
    f.doc.capture(input("first", "first"));
    await expect(f.doc.flush()).rejects.toThrow();
    const attempt = f.registry.beginAttempt("profile");
    attempts.push(attempt);
    await expect(attempt.observe()).rejects.toThrow();
    f.doc.capture(input("new full", "next"));
    await f.doc.flush();
    const recovered = f.registry.beginAttempt("profile");
    attempts.push(recovered);
    expect((await recovered.observe()).qualified).toBe(false);
    expect(f.row?.payload.text).toBe("new full");
    expect(f.row?.metadata.revision).toBe(2);
  });

  it("wakes accepted work on disposal without abandoning it", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const ticket = f.doc.capture(input("must survive disposal"));
    f.doc.dispose();
    await ticket.persisted;
    expect(f.row?.payload.text).toBe("must survive disposal");
    expect(f.doc.observe().disposed).toBe(true);
  });

  it("retires an old binding permanently while a fresh binding keeps its own subscriptions and data", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const oldListener = vi.fn();
    f.doc.subscribe(oldListener);
    f.doc.dispose();
    const rebound = f.manager.bindDocument({
      documentId: "doc",
      path: "/fixture/file.txt",
      origin: "local-native",
    });
    expect(rebound).not.toBe(f.doc);
    const freshListener = vi.fn();
    rebound.subscribe(freshListener);
    const current = rebound.capture(input("new view B"));
    await rebound.flush();
    await current.persisted;
    const count = f.putPayloads.length;
    await expect(f.doc.capture(input("stale old view A")).persisted).rejects.toMatchObject({
      code: "disposed",
    });
    expect(f.putPayloads).toHaveLength(count);
    expect(f.row?.payload.text).toBe("new view B");
    expect(oldListener).toHaveBeenCalledOnce();
    expect(freshListener.mock.calls.length).toBeGreaterThan(1);
  });

  it("retains actual jobs and errors across true module re-evaluation without reopening/rebinding the owner", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockImplementation(f.invoke);
    const binding = {
      documentId: "hmr-owned",
      path: "/fixture/hmr.txt",
      origin: "local-native" as const,
    };
    const original = bindEditorDraftDocument(binding);
    await original.ready;
    f.losePutAck();
    original.capture(input("HMR retained data"));
    await expect(original.flush()).rejects.toThrow("lost put ACK");
    original.dispose();
    const opens = f.calls.filter((call) => call === "native_editor_draft_open").length;
    vi.resetModules();
    const reloaded = await import("./editorDraftPersistence");
    const current = reloaded.bindEditorDraftDocument(binding);
    expect(current.observe().error).toBeDefined();
    await expect(original.capture(input("stale implementation")).persisted).rejects.toMatchObject({
      code: "disposed",
    });
    await current.retry();
    expect(f.calls.filter((call) => call === "native_editor_draft_open")).toHaveLength(opens);
    expect(f.putPayloads).toHaveLength(1);
    expect(current.observe().error).toBeUndefined();
    const invalid = current.capture({ ...input("invalid"), eol: "bad" as any });
    await expect(invalid.persisted).rejects.toBeInstanceOf(reloaded.EditorDraftPersistenceError);
    current.capture(input("fresh implementation"));
    await current.flush();
    current.dispose();
  });

  it("keeps old HMR jobs owned while new captures use a fresh implementation and cannot enter an old queued closure", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockImplementation(f.invoke);
    const binding = {
      documentId: "hmr-pending",
      path: "/fixture/hmr-pending.txt",
      origin: "local-native" as const,
    };
    const before = await import("./editorDraftPersistence");
    const old = before.bindEditorDraftDocument(binding);
    await old.ready;
    const held = f.holdPut();
    const accepted = old.capture(input("old active"));
    const waiting = old.flush();
    void waiting.catch(() => {});
    await vi.waitFor(() => expect(f.putPayloads).toHaveLength(1));
    old.capture(input("old queued"));
    vi.resetModules();
    const after = await import("./editorDraftPersistence");
    const fresh = after.bindEditorDraftDocument(binding);
    expect(old.observe().error).toMatchObject({ code: "implementation-changed" });
    await expect(old.capture(input("late old callback")).persisted).rejects.toMatchObject({
      code: "implementation-changed",
    });
    const latest = fresh.capture(input("new implementation"));
    expect(f.putPayloads).toHaveLength(1);
    held.resolve();
    await waiting;
    await accepted.persisted;
    await fresh.flush();
    await latest.persisted;
    expect(f.putPayloads.map((put) => put.text)).toEqual([
      "old active",
      "old queued",
      "new implementation",
    ]);
    expect(f.row?.payload.text).toBe("new implementation");
    old.dispose();
    fresh.dispose();
  });

  it("keeps rename recovery in the same native document lane and never rewrites an old accepted capture's path", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    f.losePutAck();
    f.doc.capture(input("old path retained"));
    await expect(f.doc.flush()).rejects.toThrow("lost put ACK");
    f.doc.dispose();
    const renamed = f.manager.bindDocument({
      documentId: "doc",
      path: "/fixture/renamed.txt",
      origin: "local-native",
    });
    await renamed.ready;
    renamed.capture(input("renamed full snapshot"));
    await renamed.flush();
    expect(f.putPayloads.map((put) => [put.path, put.text, put.revision])).toEqual([
      ["/fixture/file.txt", "old path retained", 1],
      ["/fixture/renamed.txt", "renamed full snapshot", 2],
    ]);
    expect(f.manager.observation().documents).toBe(1);
    const attempt = f.registry.beginAttempt("profile");
    attempts.push(attempt);
    expect((await attempt.observe()).qualified).toBe(false);
    expect(renamed.observe().path).toBe("/fixture/renamed.txt");
    expect(renamed.observe().error).toBeUndefined();
    expect(f.calls.filter((call) => call === "native_editor_draft_open")).toHaveLength(1);
  });

  it("does not let initialization's older success erase a rejected new capture", async () => {
    const f = nativeFixture();
    const rejected = f.doc.capture({ ...input("invalid"), eol: "bad" as any });
    await f.doc.ready;
    await expect(rejected.persisted).rejects.toMatchObject({ code: "invalid-capture" });
    expect(f.doc.observe().error).toMatchObject({ code: "invalid-capture" });
    await expect(f.doc.flush()).rejects.toMatchObject({ code: "invalid-capture" });
    f.doc.capture(input("new valid full snapshot"));
    await f.doc.flush();
    expect(f.doc.observe().error).toBeUndefined();
  });

  it("skips an oversized capture without raising a draft error", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = f.doc.capture(input("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(big.persisted).rejects.toMatchObject({ code: "invalid-capture" });
    expect(f.doc.observe().error).toBeUndefined();
    (console.warn as unknown as { mockRestore(): void }).mockRestore();
  });

  it("rebases only after exact conflict resolution, preserving the external row until a fresh full capture", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    f.losePutAck();
    f.doc.capture(input("A"));
    await expect(f.doc.flush()).rejects.toThrow();
    f.externalAdvance("external B");
    await expect(f.doc.retry()).rejects.toMatchObject({ code: "conflict" });
    const state = f.doc.observe();
    expect(state.currentDraft?.payload.text).toBe("external B");
    f.doc.resolveInitialization({
      decision: "replace",
      revision: state.currentDraft!.metadata.revision,
      payloadDigest: state.currentDraft!.metadata.payloadDigest,
    });
    expect(f.row?.payload.text).toBe("external B");
    f.doc.capture(input("explicit new C", "C"));
    await f.doc.flush();
    expect(f.putPayloads.map((put) => [put.text, put.revision, put.expectedRevision])).toEqual([
      ["A", 1, null],
      ["explicit new C", 3, 2],
    ]);
  });

  it("does not treat an unsuccessful initial read as proof that its Native row is absent", async () => {
    const f = nativeFixture();
    f.failRead();
    await f.doc.ready;
    f.doc.capture(input("not yet read"));
    await expect(f.doc.flush()).rejects.toMatchObject({ code: "initialization-required" });
    expect(f.putPayloads).toHaveLength(0);
    await f.doc.retry();
    expect(f.putPayloads).toHaveLength(1);
  });

  it("keeps dropped stroke tickets reaction-free and bounds explicit persistence waiters", async () => {
    vi.useFakeTimers();
    const f = nativeFixture();
    await f.doc.ready;
    const held = f.holdPut();
    f.doc.capture(input("active"));
    const active = f.doc.flush();
    void active.catch(() => {});
    await vi.waitFor(() => expect(f.putPayloads).toHaveLength(1));
    let copied = 0;
    for (let n = 0; n < 1000; n++) {
      const text = `stroke-${n}`;
      f.doc.capture(
        input({
          length: text.length,
          toString() {
            copied++;
            return text;
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(f.manager.observation()).toMatchObject({ jobs: 2, pendingSlots: 1, waiters: 0 });
    expect(copied).toBe(0);
    const tickets = Array.from({ length: 65 }, (_, n) => f.doc.capture(input(`waiter-${n}`)));
    const waiting = tickets.slice(0, 64).map((ticket) => ticket.persisted);
    await expect(tickets[64].persisted).rejects.toMatchObject({ code: "capacity" });
    expect(f.manager.observation().waiters).toBe(64);
    held.resolve();
    await active;
    await f.doc.flush();
    await Promise.all(waiting);
    expect(f.manager.observation().waiters).toBe(0);
    expect(f.putPayloads).toHaveLength(2);
  });

  it("does not silently bind old captured payloads to a new Native owner epoch", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    f.changeOwner();
    const ticket = f.doc.capture(input("old owner payload"));
    await expect(f.doc.flush()).rejects.toThrow("OWNER_CHANGED");
    await expect(ticket.persisted).rejects.toThrow();
    await expect(f.doc.retry()).rejects.toMatchObject({ code: "stale-owner" });
    expect(f.calls.filter((call) => call === "native_editor_draft_open")).toHaveLength(1);
    expect(f.row).toBeNull();
  });

  it("never reports a coalesced older save as a newer capture, including duplicate caller capture IDs", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const older = f.doc.capture(input("saved old text", "same"));
    const newer = f.doc.capture(input("unsaved new text", "same"));
    await f.doc.flush();
    await newer.persisted;
    expect(await f.doc.reportSaved(older)).toMatchObject({ state: "superseded", qualified: false });
    expect(f.savePayloads).toHaveLength(0);
    expect(f.row?.metadata.state).toBe("retained");
    expect(f.row?.payload.text).toBe("unsaved new text");
  });

  it("reports only the exact captured successful-save revision and preserves a later edit", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const saved = f.doc.capture(input("saved"));
    await f.doc.flush();
    const held = f.holdSave();
    const reporting = f.doc.reportSaved(saved);
    await vi.waitFor(() => expect(f.savePayloads).toHaveLength(1));
    const later = f.doc.capture(input("new unsaved", "later"));
    held.resolve();
    expect((await reporting).state).toBe("save-reported");
    await f.doc.flush();
    await later.persisted;
    expect(f.row?.payload.text).toBe("new unsaved");
    expect(f.row?.metadata.state).toBe("retained");
  });

  it("retries only saved-report DB acknowledgment after an uncertain saved receipt", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    const saved = f.doc.capture(input("saved"));
    await f.doc.flush();
    f.loseSaveAck();
    await expect(f.doc.reportSaved(saved)).rejects.toThrow("lost saved ACK");
    const ack = f.row?.metadata.saveAckId;
    await f.doc.retry();
    expect(f.putPayloads).toHaveLength(1);
    expect(f.savePayloads).toHaveLength(2);
    expect(f.row?.metadata.saveAckId).toBe(ack);
  });

  it("preserves save lineage when its preceding capture committed but lost its DB ACK", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    f.losePutAck();
    const saved = f.doc.capture(input("actual successful filesystem save"));
    await expect(f.doc.reportSaved(saved)).rejects.toThrow("lost put ACK");
    await f.doc.retry();
    expect(f.putPayloads).toHaveLength(1);
    expect(f.savePayloads).toHaveLength(1);
    expect(f.row?.metadata.state).toBe("save-reported");
  });

  it("keeps web and remote documents explicit and never uses selected Host routing", async () => {
    const f = nativeFixture();
    await f.doc.ready;
    for (const origin of ["web", "remote"] as const) {
      const doc = f.manager.bindDocument({ documentId: origin, path: "/file", origin });
      expect((await doc.ready).phase).toBe("unsupported");
      await expect(doc.capture(input("not local")).persisted).rejects.toMatchObject({
        code: "unsupported",
      });
    }
    expect(f.putPayloads).toHaveLength(0);
  });
});
