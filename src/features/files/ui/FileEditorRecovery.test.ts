// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileEditor, FILE_EDITOR_AUTOSAVE_DELAY_MS } from "./FileEditor";
import { invalidateWatchedFiles } from "../model/fileWatch";
import type {
  EditorDraftCaptureInput,
  EditorDraftDocument,
  NativeCaptureState,
  NativeEditorDraftMetadata,
  NativeEditorDraftRecord,
} from "../data/editorDraftPersistence";
import type { RecoveredEditorDraft } from "../model/editorDraftRecovery";

// Only the Native boundary is mocked. FileEditor, CodeMirror, dirty/save logic,
// actual fileWatch registration/invalidation and React lifetimes are real.
const ports = vi.hoisted(() => ({ invoke: vi.fn(), readRecovery: vi.fn(), bind: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke: (command: string, args?: unknown) => ports.invoke(command, args),
}));
vi.mock("../data/editorDraftRecovery", () => ({
  readEditorDraftRecovery: (...args: unknown[]) => ports.readRecovery(...args),
}));
vi.mock("../data/editorDraftPersistence", () => ({
  bindEditorDraftDocument: (...args: unknown[]) => ports.bind(...args),
}));

const path = "/repo/recovery.txt";
const documentId = "33333333-3333-4333-8333-333333333333";
const ownerEpoch = "a".repeat(64);
const originalBaseline = "original\r\n";
const metadataA: NativeEditorDraftMetadata = {
  ownerId: ownerEpoch,
  storeInstance: "11111111-1111-4111-8111-111111111111",
  windowIncarnation: "22222222-2222-4222-8222-222222222222",
  windowLabel: "fixture",
  documentId,
  path,
  revision: 3,
  payloadDigest: "d".repeat(64),
  textDigest: "e".repeat(64),
  serializedTextDigest: "f".repeat(64),
  baselineDigest: "c".repeat(64),
  retainedBytes: 1024,
  state: "retained",
  saveAckId: null,
  updatedAt: 1,
};
const descriptor: RecoveredEditorDraft = {
  version: 1,
  ownerEpoch,
  documentId,
  path,
  revision: metadataA.revision,
  payloadDigest: metadataA.payloadDigest,
};
const metadataB = { ...metadataA, revision: 4, payloadDigest: "b".repeat(64) };
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Mount = { root: Root; container: HTMLDivElement; dirty: ReturnType<typeof vi.fn> };
const mounts = new Set<Mount>();
let disk: string | null;
let recordA: NativeEditorDraftRecord;
let lane: NativeCaptureState;
let listeners: Set<(state: NativeCaptureState) => void>;
let captured: EditorDraftCaptureInput[];
let jobs: Array<{ value: EditorDraftCaptureInput; resolve(): void; reject(): void }>;
let holdCaptures: boolean;
let heldRead: ReturnType<typeof deferred<string>> | undefined;
let readStarted: ReturnType<typeof deferred<void>> | undefined;
let lastBinding: EditorDraftDocument;
const resolveInitialization = vi.fn();
const reportSaved = vi.fn();
function notify() {
  for (const callback of listeners) callback(lane);
}
function recordB(value: EditorDraftCaptureInput): NativeEditorDraftRecord {
  return {
    metadata: metadataB,
    payload: {
      documentId,
      path,
      text: value.text.toString(),
      eol: value.eol,
      diskBaseline: value.diskBaseline,
      revision: 4,
    },
  };
}
function finishAccepted(mode: "newer" | "failed") {
  const job = jobs.at(-1)!;
  if (mode === "newer") {
    lane = {
      ...lane,
      pending: false,
      error: undefined,
      acknowledgedDraft: metadataB,
      currentDraft: recordB(job.value),
      phase: "retained",
    };
    job.resolve();
  } else {
    lane = {
      ...lane,
      pending: false,
      error: new Error("Accepted B persistence failed"),
      phase: "error",
    };
    job.reject();
  }
  notify();
}
function makeBinding(): EditorDraftDocument {
  let disposed = false;
  const observe = () => ({ ...lane, disposed });
  return {
    ready: Promise.resolve(observe()),
    observe,
    subscribe(listener) {
      const update = () => listener(observe());
      listeners.add(update);
      update();
      return () => {
        listeners.delete(update);
      };
    },
    capture(value) {
      captured.push(value);
      const completion = deferred<any>();
      void completion.promise.catch(() => {});
      const ticket = { ...value, documentId, path, persisted: completion.promise };
      if (holdCaptures) {
        lane = { ...lane, pending: true, captureId: value.captureId, phase: "queued" };
        jobs.push({
          value,
          resolve: () =>
            completion.resolve({
              qualified: false,
              captureId: value.captureId,
              coveredByCaptureId: value.captureId,
              record: metadataB,
            }),
          reject: () => completion.reject(new Error("Accepted B persistence failed")),
        });
        notify();
      } else
        completion.resolve({
          qualified: false,
          captureId: value.captureId,
          coveredByCaptureId: value.captureId,
          record: metadataA,
        });
      return ticket;
    },
    resolveInitialization,
    flush: async () => observe(),
    retry: async () => observe(),
    reportSaved,
    dispose() {
      disposed = true;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  storage.setItem("bycoda.formatOnSave", "0");
  vi.stubGlobal("localStorage", storage);
  disk = originalBaseline;
  recordA = {
    metadata: metadataA,
    payload: {
      documentId,
      path,
      text: "Recovered A\n",
      eol: "crlf",
      diskBaseline: originalBaseline,
      revision: 3,
    },
  };
  lane = {
    qualified: false,
    documentId,
    path,
    ownerEpoch,
    phase: "retained",
    pending: false,
    disposed: false,
    currentDraft: recordA,
    acknowledgedDraft: metadataA,
    initializationDecisionRequired: false,
  };
  listeners = new Set();
  captured = [];
  jobs = [];
  holdCaptures = false;
  heldRead = undefined;
  readStarted = undefined;
  resolveInitialization.mockReset();
  reportSaved.mockReset();
  reportSaved.mockResolvedValue({ qualified: false, state: "save-reported", record: metadataA });
  ports.bind.mockReset();
  ports.bind.mockImplementation(() => (lastBinding = makeBinding()));
  ports.readRecovery.mockReset();
  ports.readRecovery.mockImplementation(async () => recordA);
  ports.invoke.mockReset();
  ports.invoke.mockImplementation(async (command: string, args?: Record<string, any>) => {
    if (command === "read_text_file") {
      if (heldRead) {
        const read = heldRead;
        heldRead = undefined;
        readStarted?.resolve();
        return read.promise;
      }
      if (disk === null) throw new Error("Fixture disk missing");
      return disk;
    }
    if (command === "write_text_file") {
      disk = args!.content;
      return;
    }
    return [];
  });
});
afterEach(async () => {
  for (const mount of mounts) {
    await act(async () => mount.root.unmount());
    mount.container.remove();
  }
  mounts.clear();
  for (const job of jobs) job.resolve();
  vi.unstubAllGlobals();
});
async function mountEditor(): Promise<Mount> {
  const container = document.createElement("div");
  document.body.append(container);
  const mount = { root: createRoot(container), container, dirty: vi.fn() };
  mounts.add(mount);
  await act(async () =>
    mount.root.render(
      createElement(FileEditor, {
        path,
        documentId,
        recoveredEditorDraft: descriptor,
        cwd: "/repo",
        active: true,
        onDirtyChange: mount.dirty,
      }),
    ),
  );
  return mount;
}
async function unmount(mount: Mount) {
  await act(async () => mount.root.unmount());
  mounts.delete(mount);
  mount.container.remove();
}
function editor(mount: Mount) {
  const element = mount.container.querySelector<HTMLElement>(".cm-editor");
  expect(element).not.toBeNull();
  return EditorView.findFromDOM(element!)!;
}
function action(mount: Mount, text: string) {
  const found = [...mount.container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  expect(found).toBeDefined();
  return found!;
}
const writes = () => ports.invoke.mock.calls.filter(([command]) => command === "write_text_file");
function assertNoHistoricalReplay(mount: Mount) {
  expect(mount.container.textContent).toContain("Open the latest copy again from Recovery");
  expect(mount.container.querySelector(".cm-editor")).toBeNull();
  expect(captured.map((capture) => capture.text.toString())).not.toContain("Recovered A\n");
  expect(resolveInitialization).not.toHaveBeenCalled();
  expect(writes()).toHaveLength(0);
  expect(mount.container.textContent).not.toContain("Saved");
}

it.each([false, true])(
  "autoloads the prepared copy dirty and never autosaves it, including equal baseline=%s",
  async (equalBaseline) => {
    if (equalBaseline)
      recordA = { ...recordA, payload: { ...recordA.payload, text: "original\n" } };
    lane = { ...lane, currentDraft: recordA };
    localStorage.setItem("bycoda.autosave", "1");
    const mount = await mountEditor();
    expect(editor(mount).state.doc.toString()).toBe(recordA.payload.text);
    expect(mount.dirty).toHaveBeenLastCalledWith(path, true);
    expect(mount.container.textContent).toContain("Unsaved changes");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FILE_EDITOR_AUTOSAVE_DELAY_MS + 100));
    });
    expect(writes()).toHaveLength(0);
    expect(reportSaved).not.toHaveBeenCalled();
    await act(async () => action(mount, "Save").click());
    expect(disk).toBe(recordA.payload.text.replace(/\n/g, "\r\n"));
    expect(writes()).toHaveLength(1);
    expect(captured.at(-1)?.diskBaseline).toBe(originalBaseline);
    expect(reportSaved).toHaveBeenCalledOnce();
  },
);

it.each(["changed", "missing"])(
  "keeps a %s disk behind an explicit overwrite decision",
  async (mode) => {
    disk = mode === "changed" ? "Changed disk\r\n" : null;
    const mount = await mountEditor();
    expect(editor(mount).state.doc.toString()).toBe("Recovered A\n");
    expect(mount.dirty).toHaveBeenLastCalledWith(path, true);
    expect(action(mount, "Overwrite disk version")).toBeDefined();
    await act(async () => action(mount, "Save").click());
    expect(writes()).toHaveLength(0);
    expect(reportSaved).not.toHaveBeenCalled();
    await act(async () => action(mount, "Overwrite disk version").click());
    expect(disk).toBe("Recovered A\r\n");
    expect(writes()).toHaveLength(1);
    expect(captured.at(-1)?.diskBaseline).toBe(originalBaseline);
  },
);

it("actual file-watch rereads of unchanged changed-disk bytes never clear the original recovery-baseline conflict", async () => {
  disk = "Changed disk\r\n";
  const mount = await mountEditor();
  const view = editor(mount);
  const readsBefore = ports.invoke.mock.calls.filter(
    ([command]) => command === "read_text_file",
  ).length;
  for (let n = 0; n < 2; n++) await act(async () => invalidateWatchedFiles([path]));
  expect(
    ports.invoke.mock.calls.filter(([command]) => command === "read_text_file").length,
  ).toBeGreaterThan(readsBefore);
  expect(view.state.doc.toString()).toBe("Recovered A\n");
  expect(action(mount, "Overwrite disk version")).toBeDefined();
  await act(async () => action(mount, "Save").click());
  expect(writes()).toHaveLength(0);
  expect(disk).toBe("Changed disk\r\n");
  expect(mount.dirty).toHaveBeenLastCalledWith(path, true);
});

it("a failed actual file-watch read preserves the recovered dirty document and conflict", async () => {
  const mount = await mountEditor();
  const view = editor(mount);
  disk = null;
  await act(async () => invalidateWatchedFiles([path]));
  expect(view.state.doc.toString()).toBe("Recovered A\n");
  expect(action(mount, "Overwrite disk version")).toBeDefined();
  await act(async () => action(mount, "Save").click());
  expect(writes()).toHaveLength(0);
  expect(mount.dirty).toHaveBeenLastCalledWith(path, true);
});

it.each(["pending", "newer", "failed"] as const)(
  "an actual remount cannot replay historical A over an accepted %s B",
  async (mode) => {
    const original = await mountEditor();
    const view = editor(original);
    holdCaptures = true;
    act(() =>
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Accepted B\n" } }),
    );
    expect(captured.at(-1)?.text.toString()).toBe("Accepted B\n");
    await unmount(original);
    if (mode !== "pending") act(() => finishAccepted(mode));
    const remounted = await mountEditor();
    assertNoHistoricalReplay(remounted);
    expect(captured.at(-1)?.text.toString()).toBe("Accepted B\n");
  },
);

it.each(["pending", "newer", "failed"] as const)(
  "rechecks %s B after a real asynchronous disk read during a second binding's remount",
  async (mode) => {
    const live = await mountEditor();
    const liveView = editor(live);
    const previous = await mountEditor();
    await unmount(previous);
    heldRead = deferred<string>();
    const held = heldRead;
    readStarted = deferred<void>();
    const remounted = await mountEditor();
    await readStarted.promise;
    holdCaptures = true;
    act(() =>
      liveView.dispatch({
        changes: { from: 0, to: liveView.state.doc.length, insert: "Accepted B\n" },
      }),
    );
    if (mode !== "pending") act(() => finishAccepted(mode));
    await act(async () => held.resolve(originalBaseline));
    assertNoHistoricalReplay(remounted);
    expect(liveView.state.doc.toString()).toBe("Accepted B\n");
  },
);

it.each(["owner", "disposed", "missing-ack"] as const)(
  "does not adopt A with an invalid %s lane even when a historical currentDraft exists",
  async (mode) => {
    const original = await mountEditor();
    await unmount(original);
    if (mode === "owner") lane = { ...lane, ownerEpoch: "b".repeat(64) };
    if (mode === "disposed")
      ports.bind.mockImplementation(() => ({
        ...makeBinding(),
        observe: () => ({ ...lane, disposed: true }),
      }));
    if (mode === "missing-ack") lane = { ...lane, acknowledgedDraft: undefined };
    const mount = await mountEditor();
    assertNoHistoricalReplay(mount);
  },
);

it.each(["owner", "disposed", "missing-ack"] as const)(
  "rechecks an invalid %s lane after the asynchronous disk await",
  async (mode) => {
    const original = await mountEditor();
    await unmount(original);
    heldRead = deferred<string>();
    const held = heldRead;
    readStarted = deferred<void>();
    const remounted = await mountEditor();
    await readStarted.promise;
    if (mode === "owner") lane = { ...lane, ownerEpoch: "b".repeat(64) };
    if (mode === "disposed") lastBinding.dispose();
    if (mode === "missing-ack") lane = { ...lane, acknowledgedDraft: undefined };
    await act(async () => held.resolve(originalBaseline));
    assertNoHistoricalReplay(remounted);
  },
);

it("a failed exact Native recovery read remains an error rather than an absent or clean document", async () => {
  ports.readRecovery.mockRejectedValue(new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT"));
  const mount = await mountEditor();
  expect(mount.container.textContent).toContain("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
  expect(mount.container.querySelector(".cm-editor")).toBeNull();
  expect(writes()).toHaveLength(0);
  expect(mount.dirty).not.toHaveBeenCalledWith(path, false);
  expect(captured).toHaveLength(0);
  expect(resolveInitialization).not.toHaveBeenCalled();
});
