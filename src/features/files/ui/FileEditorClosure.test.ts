// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";
import {
  beginEditorInputClosure,
  captureEditorInputs,
  type EditorInputClosure,
  type MountedEditorInputLease,
} from "../data/mountedEditorClosure";
import { saveFormatOnSave } from "../../settings/model/settings";
import { chooseMergeRegion, mergeResolution } from "../../source-control/model/mergeResolution";
import { invalidateWatchedFiles } from "../model/fileWatch";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), format: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => false,
  invoke: (command: string, args?: unknown) => bridge.invoke(command, args),
}));
vi.mock("../../../shared/lib/format", () => ({
  formatProjectText: (...args: unknown[]) => bridge.format(...args),
  hasBundledFormatter: () => true,
}));
let root: Root;
let container: HTMLDivElement;
let disk: string;
let identity = 0;
let documentId: string;
const leases: MountedEditorInputLease[] = [];
const closures: EditorInputClosure[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  storage.setItem("bycoda.formatOnSave", "0");
  vi.stubGlobal("localStorage", storage);
  disk = "original\r\n";
  documentId = `closure-${++identity}`;
  bridge.invoke.mockReset();
  bridge.format.mockReset();
  bridge.format.mockResolvedValue(null);
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "read_text_file") return disk;
    if (command === "write_text_file") {
      disk = args.content;
      return;
    }
    return [];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => closures.splice(0).forEach((close) => close.release()));
  await act(async () => root.unmount());
  leases.splice(0).forEach((lease) => lease.release());
  container.remove();
  vi.unstubAllGlobals();
});

async function closeInputs() {
  let result!: EditorInputClosure;
  await act(async () => {
    result = beginEditorInputClosure("original-session", { owner: {}, timeoutMs: 10_000 });
    closures.push(result);
  });
  return result;
}
async function render(path = "/repo/editor.txt", active = true, showDiff = false) {
  await act(async () =>
    root.render(
      createElement(FileEditor, {
        path,
        documentId,
        cwd: "/repo",
        active,
        showDiff,
        onDirtyChange: () => {},
      }),
    ),
  );
}
function view() {
  return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
}
async function capture() {
  const lease = await captureEditorInputs("original-session");
  leases.push(lease);
  return lease;
}
/** Normal ready assertions wait the actual newly accounted watcher work.
 * Busy assertions intentionally continue using the immediate capture above. */
async function captureReady() {
  let result!: MountedEditorInputLease;
  await vi.waitFor(async () => {
    result = await captureEditorInputs("original-session");
    leases.push(result);
  });
  return result;
}
function save() {
  container.querySelector<HTMLButtonElement>('button[aria-label="Save"]')!.click();
}

it("registers a held loading placeholder, then reads the actual clean editor and original CRLF baseline", async () => {
  const read = deferred<string>();
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation((command, args) =>
    command === "read_text_file" ? read.promise : invoke(command, args),
  );
  await render();
  await expect(capture()).rejects.toMatchObject({ code: "busy" });
  await act(async () => read.resolve(" \tç😀\r\n"));
  const lease = await captureReady();
  expect(lease.current()).toBe(true);
  expect(lease.snapshots).toHaveLength(1);
  expect(lease.snapshots[0].snapshot).toMatchObject({
    documentId,
    path: "/repo/editor.txt",
    text: " \tç😀\n",
    eol: "crlf",
    diskBaseline: " \tç😀\r\n",
    dirty: false,
    readOnly: false,
    origin: "web",
    draftBinding: { receipt: null, exactBodyAcknowledged: false },
  });
  expect(lease.snapshots[0]).not.toHaveProperty("sessionId");
});
it("captures real immutable edits while hidden, invalidates older data and never saves or flushes for capture", async () => {
  await render();
  const before = await captureReady();
  act(() => view().dispatch({ changes: { from: 0, insert: "late " } }));
  expect(before.current()).toBe(false);
  await render("/repo/editor.txt", false);
  const after = await captureReady();
  expect(after.snapshots[0].snapshot).toMatchObject({
    text: "late original\n",
    dirty: true,
    diskBaseline: "original\r\n",
  });
  expect(before.snapshots[0].snapshot.text).toBe("original\n");
  expect(
    bridge.invoke.mock.calls.some(
      ([command]) => command === "write_text_file" || command.startsWith("native_editor_draft"),
    ),
  ).toBe(false);
});
it("holds actual composition and irreversibly invalidates the old lease without blurring or changing the document", async () => {
  await render();
  const actual = view();
  const before = await captureReady();
  act(() =>
    actual.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "ç" }),
    ),
  );
  expect(before.current()).toBe(false);
  await expect(capture()).rejects.toMatchObject({ code: "busy" });
  act(() =>
    actual.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "ç" }),
    ),
  );
  await vi.waitFor(async () => {
    const lease = await captureReady();
    expect(lease.current()).toBe(true);
    lease.release();
  });
  expect(actual.state.doc.toString()).toBe("original\n");
  expect(before.current()).toBe(false);
});
it("records actual readonly state and invalidates even a transient readonly change", async () => {
  await render();
  const actual = view();
  const mode = new Compartment();
  act(() =>
    actual.dispatch({
      effects: StateEffect.appendConfig.of(mode.of(EditorState.readOnly.of(false))),
    }),
  );
  const before = await captureReady();
  act(() => actual.dispatch({ effects: mode.reconfigure(EditorState.readOnly.of(true)) }));
  const locked = await captureReady();
  expect(locked.snapshots[0].snapshot.readOnly).toBe(true);
  act(() => actual.dispatch({ effects: mode.reconfigure(EditorState.readOnly.of(false)) }));
  expect(before.current()).toBe(false);
  expect(locked.current()).toBe(false);
  expect((await captureReady()).snapshots[0].snapshot.readOnly).toBe(false);
});
it("holds a formatter admitted before onSave and preserves a later edit rather than applying stale formatting", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "draft " } }));
  saveFormatOnSave(true);
  const formatting = deferred<{ formatted: string; cursorOffset: number }>();
  bridge.format.mockReturnValue(formatting.promise);
  const before = await captureReady();
  await act(async () => save());
  expect(bridge.format).toHaveBeenCalledOnce();
  expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
  await expect(capture()).rejects.toMatchObject({ code: "busy" });
  act(() => view().dispatch({ changes: { from: 0, insert: "later " } }));
  await act(async () => formatting.resolve({ formatted: "stale formatting\n", cursorOffset: 0 }));
  const after = await captureReady();
  expect(after.snapshots[0].snapshot.text).toBe("later draft original\n");
  expect(before.current()).toBe(false);
  expect(disk).toBe("later draft original\r\n");
});
it("holds a pending filesystem save and captures its changed baseline with newer edits still dirty", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "saved " } }));
  const write = deferred<void>();
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "write_text_file") await write.promise;
    return invoke(command, args);
  });
  const before = await captureReady();
  await act(async () => save());
  await expect(capture()).rejects.toMatchObject({ code: "busy" });
  act(() => view().dispatch({ changes: { from: 0, insert: "newer " } }));
  await act(async () => write.resolve());
  const after = await captureReady();
  expect(after.snapshots[0].snapshot).toMatchObject({
    text: "newer saved original\n",
    diskBaseline: "saved original\r\n",
    dirty: true,
  });
  expect(before.current()).toBe(false);
  expect(
    bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
  ).toHaveLength(1);
});
it("invalidates on relocation and unmount without dropping the original retained snapshot", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "kept " } }));
  const before = await captureReady();
  await render("/repo/renamed.txt");
  expect(before.current()).toBe(false);
  const relocated = await captureReady();
  expect(relocated.snapshots[0].snapshot).toMatchObject({
    path: "/repo/renamed.txt",
    text: "kept original\n",
  });
  await act(async () => root.render(null));
  expect(relocated.current()).toBe(false);
  expect(before.snapshots[0].snapshot.text).toBe("kept original\n");
  expect((await captureReady()).snapshots).toHaveLength(0);
});

it("captures the actual editable merge result and unresolved choices while preserving disk markers and undo", async () => {
  disk = "top\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> branch\r\nend\r\n";
  await render();
  const result = EditorView.findFromDOM(
    container.querySelector<HTMLElement>('[aria-label="Resolved output"]')!,
  )!;
  expect(result).toBeTruthy();
  const before = await captureReady();
  expect(before.snapshots).toHaveLength(1);
  expect(before.snapshots[0].snapshot).toMatchObject({
    editorKind: "merge",
    text: result.state.doc.toString(),
    diskBaseline: disk,
    readOnly: false,
  });
  expect(before.snapshots[0].snapshot.text).not.toContain("<<<<<<<");
  const resolution = mergeResolution(result.state);
  expect(
    (before.snapshots[0].snapshot.mergeState as { regions: { choice: null }[] }).regions[0].choice,
  ).toBeNull();
  act(() => chooseMergeRegion(result, resolution.regions[0].id, "theirs"));
  const after = await captureReady();
  expect(before.current()).toBe(false);
  expect(after.snapshots[0].snapshot.text).toBe(result.state.doc.toString());
  expect(
    (after.snapshots[0].snapshot.mergeState as { regions: { choice: string }[] }).regions[0].choice,
  ).toBe("theirs");
  act(() => expect(undo(result)).toBe(true));
  expect(after.current()).toBe(false);
  expect(mergeResolution(result.state).regions[0].choice).toBeNull();
  expect(disk).toContain("<<<<<<<");
  expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
});

it("retains an unmounted editor's actual formatter obligation without reading the retired view or writing stale text", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "draft " } }));
  saveFormatOnSave(true);
  const formatting = deferred<{ formatted: string; cursorOffset: number }>();
  bridge.format.mockReturnValue(formatting.promise);
  const original = await captureReady();
  await act(async () => save());
  await act(async () => root.render(null));
  expect(original.current()).toBe(false);
  try {
    await expect(capture()).rejects.toMatchObject({ code: "busy" });
    expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
  } finally {
    await act(async () =>
      formatting.resolve({ formatted: "stale formatter output\n", cursorOffset: 0 }),
    );
  }
  expect((await captureReady()).snapshots).toHaveLength(0);
  expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
  expect(disk).toBe("original\r\n");
});

it.each(["source", "merge"])(
  "retains an unmounted %s editor's actual filesystem save until settlement",
  async (kind) => {
    if (kind === "merge") disk = "<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> branch\r\n";
    await render();
    if (kind === "merge") {
      const result = EditorView.findFromDOM(
        container.querySelector<HTMLElement>('[aria-label="Resolved output"]')!,
      )!;
      act(() => chooseMergeRegion(result, mergeResolution(result.state).regions[0].id, "theirs"));
    } else act(() => view().dispatch({ changes: { from: 0, insert: "saved " } }));
    const write = deferred<void>();
    const invoke = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "write_text_file") await write.promise;
      return invoke(command, args);
    });
    const original = await captureReady();
    await act(async () => save());
    expect(
      bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
    ).toHaveLength(1);
    await act(async () => root.render(null));
    expect(original.current()).toBe(false);
    try {
      await expect(capture()).rejects.toMatchObject({ code: "busy" });
    } finally {
      await act(async () => write.resolve());
    }
    expect((await captureReady()).snapshots).toHaveLength(0);
    expect(
      bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
    ).toHaveLength(1);
    expect(disk).toBe(kind === "merge" ? "theirs\r\n" : "saved original\r\n");
  },
);

it("lets an original formatter/save reach its explicit filesystem child after closure while refusing new edits and saves", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "draft " } }));
  saveFormatOnSave(true);
  const formatting = deferred<{ formatted: string; cursorOffset: number }>();
  bridge.format.mockReturnValue(formatting.promise);
  await act(async () => save());
  const close = await closeInputs();
  expect(container.textContent).toContain("Preparing checkpoint");
  const original = view().state.doc.toString();
  act(() => view().dispatch({ changes: { from: 0, insert: "denied " }, filter: false }));
  expect(view().state.doc.toString()).toBe(original);
  let finished = false;
  const capture = close.capture().then((data) => {
    finished = true;
    return data;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  await act(async () => formatting.resolve({ formatted: "formatted original\n", cursorOffset: 0 }));
  const data = await capture;
  expect(data.snapshots[0].snapshot.text).toBe("formatted original\n");
  expect(disk).toBe("formatted original\r\n");
  expect(
    bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
  ).toHaveLength(1);
  expect(close.current()).toBe(true);
});

it("waits an original filesystem save while preserving a newer pre-close dirty body and its original saved baseline", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "saved " } }));
  const write = deferred<void>();
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "write_text_file") await write.promise;
    return invoke(command, args);
  });
  await act(async () => save());
  act(() => view().dispatch({ changes: { from: 0, insert: "newer " } }));
  const close = await closeInputs();
  const capture = close.capture();
  await act(async () => write.resolve());
  const data = await capture;
  expect(data.snapshots[0].snapshot).toMatchObject({
    text: "newer saved original\n",
    diskBaseline: "saved original\r\n",
    dirty: true,
  });
  expect(close.current()).toBe(true);
});

it("holds an active IME before changing editor readOnly or focus", async () => {
  await render();
  const actual = view();
  const focus = document.activeElement;
  act(() =>
    actual.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  expect(() => beginEditorInputClosure("s", { owner: {}, timeoutMs: 1000 })).toThrow();
  expect(actual.state.readOnly).toBe(false);
  expect(document.activeElement).toBe(focus);
  act(() =>
    actual.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await vi.waitFor(async () => {
    const close = await closeInputs();
    expect(close.current()).toBe(true);
  });
});

it("preserves a late external disk notification and dirty text, invalidates closure, and verifies the conflict after reopening", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "unsaved " } }));
  const close = await closeInputs();
  disk = "external actor\r\n";
  act(() => invalidateWatchedFiles(["/repo/editor.txt"]));
  expect(close.current()).toBe(false);
  expect(view().state.doc.toString()).toBe("unsaved original\n");
  await expect(close.capture()).rejects.toMatchObject({ code: "busy" });
  await act(async () => close.release());
  await vi.waitFor(() => expect(container.textContent).toContain("changed on disk"));
  expect(view().state.doc.toString()).toBe("unsaved original\n");
  expect(disk).toBe("external actor\r\n");
  expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
});

it("finishes an original merge filesystem save and refuses a new merge decision while the input gate is held", async () => {
  disk = "<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> branch\r\n";
  await render();
  const result = EditorView.findFromDOM(
    container.querySelector<HTMLElement>('[aria-label="Resolved output"]')!,
  )!;
  const id = mergeResolution(result.state).regions[0].id;
  act(() => chooseMergeRegion(result, id, "theirs"));
  const write = deferred<void>();
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "write_text_file") await write.promise;
    return invoke(command, args);
  });
  await act(async () => save());
  const close = await closeInputs();
  const original = result.state.doc.toString();
  act(() => chooseMergeRegion(result, id, "ours"));
  expect(result.state.doc.toString()).toBe(original);
  expect(mergeResolution(result.state).regions[0].choice).toBe("theirs");
  const capturing = close.capture();
  void capturing.catch(() => {});
  await act(async () => write.resolve());
  expect(disk).toBe("theirs\r\n");
  expect(
    bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
  ).toHaveLength(1);
  // Applying the saved value can require a new merge initialization/view.
  // That legitimate model transition invalidates rather than refreshing this nonce.
  await capturing.catch(() => {});
  expect(close.current()).toBe(false);
});

it("does not apply an original formatter or grant its save to a replacement document mount", async () => {
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "old draft " } }));
  saveFormatOnSave(true);
  const formatting = deferred<{ formatted: string; cursorOffset: number }>();
  bridge.format.mockReturnValue(formatting.promise);
  await act(async () => save());
  const close = await closeInputs();
  const capturing = close.capture();
  void capturing.catch(() => {});
  documentId = "replacement-formatter-document";
  disk = "replacement\r\n";
  await render("/repo/replacement.txt");
  expect(close.current()).toBe(false);
  await act(async () =>
    formatting.resolve({ formatted: "stale original formatter\n", cursorOffset: 0 }),
  );
  await expect(capturing).rejects.toMatchObject({ code: "busy" });
  expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
  await act(async () => close.release());
  await vi.waitFor(() => expect(view().state.doc.toString()).toBe("replacement\n"));
  expect(disk).toBe("replacement\r\n");
});

it("finishes an already admitted filesystem write only for its original path after a replacement mount", async () => {
  const files = new Map([
    ["/repo/editor.txt", "original\r\n"],
    ["/repo/replacement.txt", "replacement\r\n"],
  ]);
  const write = deferred<void>();
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "read_text_file") return files.get(args.path);
    if (command === "write_text_file") {
      await write.promise;
      files.set(args.path, args.content);
      return;
    }
    return invoke(command, args);
  });
  await render();
  act(() => view().dispatch({ changes: { from: 0, insert: "old saved " } }));
  await act(async () => save());
  const close = await closeInputs();
  const capturing = close.capture();
  void capturing.catch(() => {});
  documentId = "replacement-filesystem-document";
  await render("/repo/replacement.txt");
  await act(async () => write.resolve());
  await expect(capturing).rejects.toMatchObject({ code: "busy" });
  expect(files.get("/repo/editor.txt")).toBe("old saved original\r\n");
  expect(files.get("/repo/replacement.txt")).toBe("replacement\r\n");
  expect(
    bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
  ).toHaveLength(1);
  await act(async () => close.release());
  const data = await captureReady();
  expect(data.snapshots[0].snapshot).toMatchObject({
    documentId,
    path: "/repo/replacement.txt",
    text: "replacement\n",
    diskBaseline: "replacement\r\n",
  });
});

async function renderSplitForWatcher() {
  localStorage.setItem("bycoda.diffLayout", "split");
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation((command, args) => {
    if (command === "git_diff_files")
      return { files: [{ relative: "editor.txt", staged: false, unstaged: true }] };
    if (command === "git_file_diff")
      return { original: "original\r\n", current: disk, binary: false, tooLarge: false };
    return invoke(command, args);
  });
  await render("/repo/editor.txt", true, true);
  await vi.waitFor(() => expect(container.querySelector(".cm-mergeView")).not.toBeNull());
  await captureReady();
}

it("drains a real split diff watcher notification accepted before input closure without invalidating its unchanged cut", async () => {
  await renderSplitForWatcher();
  let close!: EditorInputClosure;
  await act(async () => {
    invalidateWatchedFiles(["/repo/editor.txt"]);
    close = beginEditorInputClosure("original-session", { owner: {}, timeoutMs: 10_000 });
    closures.push(close);
  });
  expect(close.current()).toBe(true);
  let finished = false;
  const capturing = close.capture().then((data) => {
    finished = true;
    return data;
  });
  void capturing.catch(() => {});
  await Promise.resolve();
  expect(finished).toBe(false);
  const data = await capturing;
  expect(data.snapshots[0].snapshot).toMatchObject({
    text: "original\n",
    diskBaseline: "original\r\n",
    dirty: false,
  });
  expect(close.current()).toBe(true);
  expect(disk).toBe("original\r\n");
  expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
});

it("keeps a real split diff watcher notification after closure external and applies it only after reopening", async () => {
  await renderSplitForWatcher();
  const close = await closeInputs();
  disk = "external diff edit\r\n";
  act(() => invalidateWatchedFiles(["/repo/editor.txt"]));
  expect(close.current()).toBe(false);
  await expect(close.capture()).rejects.toMatchObject({ code: "busy" });
  await act(async () => close.release());
  const data = await captureReady();
  expect(data.snapshots[0].snapshot).toMatchObject({
    text: "external diff edit\n",
    diskBaseline: "external diff edit\r\n",
  });
  expect(bridge.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
});
