// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Fragment, StrictMode, act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { NotesView as RawNotesView } from "./NotesView";
import { SessionNotesPanel } from "./SessionNotesPanel";
import { NoteDraftRecoveryNotice } from "./NoteDraftRecoveryNotice";
import { NoteMarkdownEditor } from "./NoteMarkdownEditor";
import {
  beginNotesInputClosure,
  captureNotesInputs,
  type NotesInputClosure,
} from "../notesInputClosure";
import { drafts, noteSaveQueues, removeNoteDraft } from "../noteDrafts";
import {
  deleteNote,
  invalidateNotes,
  resolveNoteImagePath,
  upsertNote,
  type Note,
  type NoteUpsert,
} from "../notes";
import { NoteInputOwner, publishNoteInputResult } from "../notesInputOwners";
import { useNoteExternal } from "../useNoteInput";
import { OPEN_NOTE_LIBRARY_EVENT } from "../noteNavigation";
import { TagInput } from "../../../shared/ui/TagInput";
import { resetNoteInputWindowForTest } from "../testing/noteInputWindow.test-support";

const invoke = vi.hoisted(() => vi.fn());
const openDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    isFullscreen: async () => false,
  }),
}));
const NotesView = withQueryClient(RawNotesView);
let root: Root, host: HTMLDivElement, stored: Note;
const closures: NotesInputClosure[] = [];
beforeEach(() => {
  resetNoteInputWindowForTest();
  resetRetainedState();
  invalidateNotes();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  stored = {
    id: crypto.randomUUID(),
    slug: "exact",
    title: "Exact note",
    body: "Original.\r\n\r\n```custom\r\nopaque block\r\n```\r\n",
    tags: ["saved-tag"],
    sourceCwd: "/repo/project",
    sourceSessionId: "target",
    createdAt: 1,
    updatedAt: 1,
  };
  invoke
    .mockReset()
    .mockImplementation(
      async (command: string, args?: { note: NoteUpsert; id: string; sourcePath: string }) => {
        if (command === "notes_list" || command === "notes_list_summaries") return [{ ...stored }];
        if (command === "notes_get") return args?.id === stored.id ? { ...stored } : null;
        if (command === "notes_upsert") {
          if (
            args!.note.expectedUpdatedAt !== stored.updatedAt &&
            args!.note.expectedUpdatedAt !== 0
          )
            throw new Error("original CAS conflict");
          stored = { ...stored, ...args!.note, updatedAt: stored.updatedAt + 1 };
          return { ...stored };
        }
        if (command === "notes_save_image")
          return { name: "image.png", markdownPath: `/note-assets/${stored.id}/image.png` };
        if (command === "notes_image_path") return "/isolated/image.png";
        return [];
      },
    );
  openDialog.mockReset().mockResolvedValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  closures.splice(0).forEach((gate) => gate.release());
  await act(async () => root.unmount());
  await act(async () => {
    await Promise.allSettled([...noteSaveQueues.values()].map((queue) => queue.pending));
  });
  host.remove();
  for (const id of drafts.keys()) removeNoteDraft(id);
  vi.unstubAllGlobals();
});
async function render(both = false, strict = false) {
  const tree = createElement(
    Fragment,
    null,
    createElement(NotesView, {
      cwd: "/repo/project",
      recents: [{ path: "/repo/project", openedAt: 1 }],
      onClose: vi.fn(),
    }),
    both ? createElement(SessionNotesPanel, { cwd: "/repo/project", sessionId: "target" }) : null,
  );
  await act(async () => root.render(strict ? createElement(StrictMode, null, tree) : tree));
  await vi.waitFor(() =>
    expect(host.querySelector("[data-note-editor] .cm-editor")).not.toBeNull(),
  );
}
function source() {
  return EditorView.findFromDOM(host.querySelector<HTMLElement>("[data-note-editor] .cm-editor")!)!;
}
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label,
  );
  expect(found, label).toBeTruthy();
  return found!;
}
async function ready() {
  let data!: Awaited<ReturnType<typeof captureNotesInputs>>;
  await vi.waitFor(async () => {
    data = await captureNotesInputs("target");
  });
  return data;
}
function close() {
  let gate!: NotesInputClosure;
  act(() => {
    gate = beginNotesInputClosure("target", { owner: {}, timeoutMs: 10_000 });
  });
  closures.push(gate);
  return gate;
}
async function input(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("captures actual canonical bytes and hidden Source, blocking direct CM bypass while retaining unsupported Markdown", async () => {
  await render();
  const before = await ready();
  before.release();
  const actual = source();
  const original = actual.state.doc.toString();
  const gate = close();
  const data = await gate.capture();
  const row = data.snapshots.find(
    (item) => item.snapshot.surface === "library" && item.snapshot.noteId === stored.id,
  )!;
  expect(row.kind).toBe("note-editor");
  expect(row.snapshot.canonical).toMatchObject({ body: stored.body });
  expect(row.snapshot.inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        inputKind: "codemirror",
        text: stored.body.replace(/\r\n?/g, "\n"),
      }),
    ]),
  );
  act(() => {
    actual.dispatch({ changes: { from: 0, insert: "bypass" }, filter: false });
    actual.update([actual.state.update({ changes: { from: 0, insert: "direct" } })]);
    actual.setState(EditorState.create({ doc: "replacement" }));
  });
  expect(actual.state.doc.toString()).toBe(original);
  expect(gate.current()).toBe(true);
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  data.release();
});

it("holds real title IME before changing readOnly or focus", async () => {
  await render();
  const data = await ready();
  data.release();
  const title = host.querySelector<HTMLInputElement>('input[aria-label="Note title"]')!;
  act(() => {
    title.focus();
    title.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  expect(() => beginNotesInputClosure("target", { owner: {}, timeoutMs: 1000 })).toThrow();
  expect(title.readOnly).toBe(false);
  expect(document.activeElement).toBe(title);
  act(() => title.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await vi.waitFor(() => {
    const gate = close();
    expect(gate.current()).toBe(true);
  });
});

it("captures uncommitted private library tags and session title without blur or Native save", async () => {
  await render(true);
  const titleButton = host.querySelector<HTMLButtonElement>('button[aria-label^="Note title:"]')!;
  await act(async () => titleButton.click());
  const inline = host.querySelectorAll<HTMLInputElement>('input[aria-label="Note title"]');
  await input(inline[inline.length - 1], "Private unsaved title");
  await input(
    host.querySelector<HTMLInputElement>('input[aria-label="Add note tag"]')!,
    "private-tag-draft",
  );
  const gate = close();
  const data = await gate.capture();
  const ports = data.snapshots.flatMap(
    (row) => (row.snapshot.inputs ?? []) as Record<string, unknown>[],
  );
  expect(ports).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "inline-edit", draft: "Private unsaved title" }),
      expect.objectContaining({ source: "tag-input", draft: "private-tag-draft" }),
    ]),
  );
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  expect(inline[inline.length - 1].value).toBe("Private unsaved title");
  data.release();
});

it("keeps an actual pre-close autosave charged until Native settles and refuses new closed ingress", async () => {
  await render();
  const baseline = await ready();
  baseline.release();
  const result = deferred<void>();
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === "notes_upsert") await result.promise;
    return actual(command, args);
  });
  act(() => source().dispatch({ changes: { from: 0, insert: "accepted " } }));
  const gate = close();
  let finished = false;
  const capturing = gate.capture().then((data) => {
    finished = true;
    return data;
  });
  void capturing.catch(() => {});
  try {
    await vi.waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(1),
    );
    expect(finished).toBe(false);
    await expect(
      upsertNote({ id: "forbidden", expectedUpdatedAt: 0, title: "No", body: "no", tags: [] }),
    ).rejects.toThrow("Preparing checkpoint");
  } finally {
    await act(async () => result.resolve());
  }
  const data = await capturing;
  expect(gate.current()).toBe(true);
  expect(data.current()).toBe(true);
  const captured = data.snapshots.find(
    (row) => row.snapshot.noteId === stored.id && row.snapshot.surface === "library",
  )!;
  expect(captured.snapshot).toMatchObject({
    canonical: { body: stored.body },
    base: { body: stored.body, updatedAt: stored.updatedAt },
  });
  expect(captured.snapshot.inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ inputKind: "codemirror", text: stored.body }),
    ]),
  );
  expect(stored.body).toContain("accepted Original.");
  expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(1);
  await expect(
    upsertNote({ id: "still-closed", expectedUpdatedAt: 0, title: "No", body: "no", tags: [] }),
  ).rejects.toThrow("Preparing checkpoint");
  data.release();
  await act(async () => gate.release());
  const settled = await ready();
  settled.release();
});

it("retains a failed original save after unmount and gates detached recovery retry", async () => {
  await render();
  const baseline = await ready();
  baseline.release();
  const result = deferred<void>();
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === "notes_upsert") await result.promise;
    return actual(command, args);
  });
  act(() => source().dispatch({ changes: { from: 0, insert: "retained " } }));
  await act(async () => button("Save").click());
  const gate = close();
  await act(async () => root.render(null));
  await expect(captureNotesInputs("target")).rejects.toMatchObject({ code: "busy" });
  await act(async () => result.reject(new Error("original retained failure")));
  await act(async () => gate.release());
  const retained = await ready();
  expect(
    retained.snapshots.find((row) => row.snapshot.noteId === stored.id)?.snapshot,
  ).toMatchObject({
    surface: "retained-draft",
    error: "original retained failure",
    canonical: { body: expect.stringContaining("retained Original.") },
  });
  retained.release();
  await act(async () => root.render(createElement(NoteDraftRecoveryNotice)));
  const recoveryGate = close();
  await act(async () => button("Retry save").click());
  expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(1);
  await act(async () => recoveryGate.release());
});

it("keeps ordinary unregistered Skills-style Markdown editing and callback semantics", async () => {
  const change = vi.fn();
  const save = vi.fn();
  const viewRef = { current: null as EditorView | null };
  await act(async () =>
    root.render(
      createElement(NoteMarkdownEditor, {
        value: "skill **source**",
        viewRef,
        onChange: change,
        onSave: save,
      }),
    ),
  );
  const gate = close();
  act(() => viewRef.current!.dispatch({ changes: { from: 0, insert: "edited " }, filter: false }));
  expect(change).toHaveBeenCalledExactlyOnceWith("edited skill **source**");
  expect(viewRef.current!.state.readOnly).toBe(false);
  expect((await gate.capture()).snapshots.some((row) => row.snapshot.surface === "library")).toBe(
    false,
  );
});

it("gates the actual editable preview range without rewriting its unsupported neighbours", async () => {
  await render();
  const edit = host.querySelector<HTMLElement>("[data-note-preview] [data-action-primary]")!;
  await act(async () => edit.click());
  const view = EditorView.findFromDOM(
    host.querySelector<HTMLElement>("[data-note-preview] .cm-editor")!,
  )!;
  const original = view.state.doc.toString();
  const gate = close();
  const data = await gate.capture();
  act(() =>
    view.dispatch({ changes: { from: 0, insert: "closed range mutation" }, filter: false }),
  );
  expect(view.state.doc.toString()).toBe(original);
  expect(stored.body).toContain("```custom\r\nopaque block");
  expect(data.snapshots.find((row) => row.snapshot.noteId === stored.id)?.snapshot.inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        inputKind: "preview-range",
        active: expect.objectContaining({ from: 0 }),
      }),
    ]),
  );
  data.release();
});

it("retains independently divergent library and dock bodies when both actual CAS saves fail", async () => {
  await render(true);
  const baseline = await ready();
  baseline.release();
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "notes_upsert"
      ? Promise.reject(new Error("original divergent conflict"))
      : actual(command, args),
  );
  act(() => source().dispatch({ changes: { from: 0, insert: "library-only " } }));
  await input(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')!,
    "dock-only exact body",
  );
  await vi.waitFor(() =>
    expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(2),
  );
  const data = await ready();
  const rows = data.snapshots.filter((row) => row.snapshot.noteId === stored.id);
  expect(rows.map((row) => row.snapshot.canonical)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ body: expect.stringContaining("library-only Original.") }),
      expect.objectContaining({ body: "dock-only exact body" }),
    ]),
  );
  expect(rows.every((row) => row.snapshot.error === "original divergent conflict")).toBe(true);
  data.release();
});

it("carries an original image picker through conversion and late body insertion while new picker work is closed", async () => {
  await render();
  const baseline = await ready();
  baseline.release();
  const selected = deferred<string[]>();
  openDialog.mockReturnValue(selected.promise);
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) =>
    command === "inspect_paths"
      ? [{ path: "/incoming/image.png", name: "image.png", size: 7, isDir: false }]
      : actual(command, args),
  );
  await act(async () => button("Insert image").click());
  const gate = close();
  const capturing = gate.capture();
  void capturing.catch(() => {});
  await expect(captureNotesInputs("target")).rejects.toMatchObject({ code: "busy" });
  await act(async () => button("Insert image").click());
  expect(openDialog).toHaveBeenCalledOnce();
  await act(async () => selected.resolve(["/incoming/image.png"]));
  await vi.waitFor(() =>
    expect(invoke.mock.calls.filter(([command]) => command === "notes_save_image")).toHaveLength(1),
  );
  await vi.waitFor(() =>
    expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(1),
  );
  expect(stored.body).toContain(`/note-assets/${stored.id}/image.png`);
  const closed = await capturing;
  expect(gate.current()).toBe(true);
  expect(closed.current()).toBe(true);
  expect(
    closed.snapshots.find((row) => row.snapshot.noteId === stored.id)!.snapshot.canonical,
  ).toMatchObject({ body: stored.body });
  expect(invoke.mock.calls.filter(([command]) => command === "notes_image_path")).toHaveLength(1);
  const effectCount = invoke.mock.calls.length;
  expect(await resolveNoteImagePath(`/note-assets/${stored.id}/image.png`)).toBe(
    "/isolated/image.png",
  );
  expect(invoke.mock.calls).toHaveLength(effectCount);
  expect(gate.current()).toBe(true);
  closed.release();
  await act(async () => gate.release());
  expect(await resolveNoteImagePath(`/note-assets/${stored.id}/image.png`)).toBe(
    "/isolated/image.png",
  );
  expect(invoke.mock.calls).toHaveLength(effectCount);
  const data = await ready();
  data.release();
});

it("retains the actual saved image and original request on display-grant failure without publishing or replaying Markdown", async () => {
  await render();
  (await ready()).release();
  const initialBody = stored.body;
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === "inspect_paths")
      return [{ path: "/incoming/image.png", name: "image.png", size: 7, isDir: false }];
    if (command === "notes_image_path") throw new Error("Original asset grant refused");
    return actual(command, args);
  });
  const selected = deferred<string[]>();
  openDialog.mockReturnValue(selected.promise);
  await act(async () => button("Insert image").click());
  const gate = close();
  const pending = gate.capture();
  void pending.catch(() => {});
  await act(async () => selected.resolve(["/incoming/image.png"]));
  const cut = await pending;
  try {
    const row = cut.snapshots.find((row) => row.snapshot.noteId === stored.id)!;
    expect(row.snapshot.imageApplicationErrors).toEqual([
      expect.objectContaining({
        asset: { name: "image.png", markdownPath: `/note-assets/${stored.id}/image.png` },
      }),
    ]);
    expect(row.snapshot.error).toContain("Image saved; display preparation failed");
    expect(row.snapshot.canonical).toMatchObject({ body: initialBody });
    expect(cut.current()).toBe(true);
    expect(
      cut.snapshots.find((row) => row.snapshot.surface === "service-intents")!.snapshot.records,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "notes_save_image",
          phase: "result-application-unverified",
        }),
      ]),
    );
  } finally {
    cut.release();
    gate.release();
  }
  await act(async () => root.render(null));
  const retained = await ready();
  expect(
    retained.snapshots.find((row) => row.snapshot.noteId === stored.id)!.snapshot
      .imageApplicationErrors,
  ).toHaveLength(1);
  retained.release();
  expect(stored.body).toBe(initialBody);
  expect(invoke.mock.calls.filter(([command]) => command === "notes_save_image")).toHaveLength(1);
  expect(invoke.mock.calls.filter(([command]) => command === "notes_image_path")).toHaveLength(1);
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
});

it("keeps the actual library draft and owner through StrictEffects replay and a retained failure", async () => {
  await render(false, true);
  const baseline = await ready();
  baseline.release();
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "notes_upsert"
      ? Promise.reject(new Error("StrictEffects original failure"))
      : actual(command, args),
  );
  act(() => source().dispatch({ changes: { from: 0, insert: "strict retained " } }));
  await act(async () => button("Save").click());
  const record = drafts.get(stored.id)!;
  expect(record.edits.current.body).toContain("strict retained Original.");
  expect(record.error).toBe("StrictEffects original failure");
  await act(async () => root.render(null));
  const data = await ready();
  expect(data.snapshots.filter((row) => row.snapshot.noteId === stored.id)).toHaveLength(1);
  expect(data.snapshots.find((row) => row.snapshot.noteId === stored.id)?.snapshot).toMatchObject({
    surface: "retained-draft",
    error: "StrictEffects original failure",
  });
  data.release();
});

it("keeps an actual deferred InlineEdit submit in its original owner across close and the real Native save", async () => {
  await render(true);
  const baseline = await ready();
  baseline.release();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label^="Note title:"]')!.click(),
  );
  const fields = host.querySelectorAll<HTMLInputElement>('input[aria-label="Note title"]');
  const field = fields[fields.length - 1];
  await input(field, "Original deferred title");
  const result = deferred<void>();
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === "notes_upsert") await result.promise;
    return actual(command, args);
  });
  let gate!: NotesInputClosure;
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    gate = beginNotesInputClosure("target", { owner: {}, timeoutMs: 10_000 });
    closures.push(gate);
  });
  const capturing = gate.capture();
  void capturing.catch(() => {});
  try {
    await vi.waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(1),
    );
    expect(stored.title).toBe("Exact note");
  } finally {
    await act(async () => result.resolve());
  }
  const data = await capturing;
  expect(gate.current()).toBe(true);
  expect(data.current()).toBe(true);
  const captured = data.snapshots.find(
    (row) => row.snapshot.noteId === stored.id && row.snapshot.surface === "session-dock",
  )!;
  expect(captured.snapshot).toMatchObject({
    canonical: { title: "Original deferred title" },
    base: { title: "Original deferred title", updatedAt: stored.updatedAt },
  });
  expect(captured.snapshot.inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "inline-edit",
        value: "Original deferred title",
        committed: "Original deferred title",
        draft: "Original deferred title",
        phase: "saved",
      }),
    ]),
  );
  await expect(
    upsertNote({ id: "still-closed", expectedUpdatedAt: 0, title: "No", body: "no", tags: [] }),
  ).rejects.toThrow("Preparing checkpoint");
  data.release();
  expect(stored.title).toBe("Original deferred title");
  expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(1);
});

it("treats a real committed equal-byte unmarked canonical refresh and ABA as external during owned-result drain", async () => {
  const inputOwner = new NoteInputOwner(() => ({
    surface: "library",
    noteId: stored.id,
    canonical: stored,
  }));
  function CanonicalView({ value }: { value: Note }) {
    useNoteExternal(inputOwner, value);
    return createElement("span", null, value.body);
  }
  try {
    await act(async () => root.render(createElement(CanonicalView, { value: stored })));
    const original = inputOwner.operation("actual-writer")!;
    const gate = close();
    const saved = { ...stored, updatedAt: 2 };
    original.apply(() => publishNoteInputResult(original, saved));
    original();
    await act(async () => root.render(createElement(CanonicalView, { value: { ...saved } })));
    expect(host.textContent).toBe(saved.body);
    expect(gate.current()).toBe(false);
    await act(async () => root.render(createElement(CanonicalView, { value: stored })));
    await act(async () => root.render(createElement(CanonicalView, { value: saved })));
    expect(gate.current()).toBe(false);
    await expect(gate.capture()).rejects.toMatchObject({ code: "busy" });
    expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  } finally {
    await act(async () => root.render(null));
    inputOwner.retire();
  }
});

it("applies changed external canonical Markdown after a stale private proof without leaving the real view held", async () => {
  const inputOwner = new NoteInputOwner(() => ({ surface: "library", noteId: stored.id }));
  const observer = inputOwner.observer("source");
  const viewRef = { current: null as EditorView | null };
  const props = {
    value: "old source",
    viewRef,
    inputObserver: observer,
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
  let finishOriginal = () => {};
  try {
    await act(async () => root.render(createElement(NoteMarkdownEditor, props)));
    const original = inputOwner.operation("original-save")!;
    finishOriginal = original;
    const replacement = "external canonical replacement\n漢🦀";
    const staleProof = inputOwner.publishControl("source", replacement, original);
    expect(staleProof).toBeDefined();
    const gate = close();
    inputOwner.external(() => {});
    await act(async () =>
      root.render(
        createElement(NoteMarkdownEditor, {
          ...props,
          value: replacement,
          inputPublication: staleProof,
        }),
      ),
    );
    expect(viewRef.current!.state.doc.toString()).toBe(replacement);
    expect(gate.current()).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
    original();
    await act(async () => gate.release());
    const data = await captureNotesInputs("target");
    expect(
      data.snapshots.find((row) => row.snapshot.noteId === stored.id)!.snapshot.inputs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inputKind: "codemirror", text: replacement }),
      ]),
    );
    data.release();
    expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  } finally {
    finishOriginal();
    await act(async () => root.render(null));
    inputOwner.retire();
  }
});

it("does not repeat a real Source projection whose attempted dispatch outcome is unknown", async () => {
  const inputOwner = new NoteInputOwner(() => ({ surface: "library", noteId: stored.id }));
  const observer = inputOwner.observer("source");
  const viewRef = { current: null as EditorView | null };
  const props = {
    value: "original source",
    viewRef,
    inputObserver: observer,
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
  let finishOriginal = () => {};
  let restore = () => {};
  try {
    await act(async () => root.render(createElement(NoteMarkdownEditor, props)));
    const original = inputOwner.operation("actual-source-publication")!;
    finishOriginal = original;
    const replacement = "owned publication";
    const proof = inputOwner.publishControl("source", replacement, original);
    const gate = close();
    const dispatch = vi.spyOn(viewRef.current!, "dispatch").mockImplementation(() => {
      throw new Error("unknown original Source dispatch outcome");
    });
    restore = () => dispatch.mockRestore();
    await act(async () =>
      root.render(
        createElement(NoteMarkdownEditor, {
          ...props,
          value: replacement,
          inputPublication: proof,
        }),
      ),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(gate.current()).toBe(false);
    await expect(captureNotesInputs("target")).rejects.toMatchObject({ code: "busy" });
    expect(props.onChange).not.toHaveBeenCalled();
  } finally {
    restore();
    finishOriginal();
    await act(async () => root.render(null));
    inputOwner.retire();
  }
});

it("continues one original bulk-delete across closure for twenty undrafted rows and preserves its partial failure selection", async () => {
  let all = Array.from({ length: 21 }, (_, index) => ({
    ...stored,
    id: index ? `undrafted-${index}` : stored.id,
    title: `Bulk note ${index}`,
  }));
  const failedId = all[20].id;
  const firstResult = deferred<void>();
  const deleted: string[] = [];
  invoke.mockImplementation(async (command, args) => {
    if (command === "notes_list" || command === "notes_list_summaries")
      return all.map((note) => ({ ...note }));
    if (command === "notes_get") return all.find((note) => note.id === args.id) ?? null;
    if (command === "notes_delete") {
      if (!deleted.length) await firstResult.promise;
      if (args.id === failedId) throw new Error("Original selected row denied");
      deleted.push(args.id);
      all = all.filter((note) => note.id !== args.id);
      return;
    }
    throw new Error(`Unexpected bulk effect: ${command}`);
  });
  try {
    await render();
    const baseline = await ready();
    baseline.release();
    expect(all.filter((note) => !drafts.has(note.id))).toHaveLength(20);
    await act(async () => button("Select notes").click());
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="Select all filtered notes"]')!.click(),
    );
    await act(async () => button("Delete selected").click());
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find(
      (node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === "Confirm delete",
    );
    expect(confirm).toBeTruthy();
    expect(confirm!.disabled).toBe(false);
    await act(async () => confirm!.click());
    await vi.waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === "notes_delete")).toHaveLength(1),
    );
    const gate = close();
    await expect(captureNotesInputs("target")).rejects.toMatchObject({ code: "busy" });
    await expect(deleteNote("fresh-closed-row", 1)).rejects.toThrow("Preparing checkpoint");
    await act(async () => firstResult.resolve());
    await vi.waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === "notes_delete")).toHaveLength(21),
    );
    await vi.waitFor(() => expect(host.textContent).toContain("1 selected"));
    expect(all.map((note) => note.id)).toEqual([failedId]);
    expect(new Set(deleted).size).toBe(20);
    expect(deleted).toHaveLength(20);
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Select note: Bulk note 20"]')!.checked,
    ).toBe(true);
    expect(document.body.textContent).toContain("Original selected row denied");
    await expect(deleteNote("still-closed-row", 1)).rejects.toThrow("Preparing checkpoint");
    expect(invoke.mock.calls.filter(([command]) => command === "notes_delete")).toHaveLength(21);
  } finally {
    await act(async () => firstResult.resolve());
  }
});

it("preserves an original clean-draft image insertion after unmount until its late Native result and save failure settle", async () => {
  await render();
  const baseline = await ready();
  baseline.release();
  const selected = deferred<string[]>();
  openDialog.mockReturnValue(selected.promise);
  const actual = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    if (command === "inspect_paths")
      return [{ path: "/incoming/image.png", name: "image.png", size: 7, isDir: false }];
    if (command === "notes_upsert") throw new Error("Original late image save failed");
    return actual(command, args);
  });
  try {
    await act(async () => button("Insert image").click());
    await act(async () => root.render(null));
    await act(async () =>
      Promise.allSettled([...noteSaveQueues.values()].map((queue) => queue.pending)),
    );
    expect(drafts.has(stored.id)).toBe(true);
    await act(async () => selected.resolve(["/incoming/image.png"]));
    await vi.waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === "notes_upsert")).toHaveLength(1),
    );
    const data = await ready();
    expect(data.snapshots.find((row) => row.snapshot.noteId === stored.id)?.snapshot).toMatchObject(
      {
        surface: "retained-draft",
        error: "Original late image save failed",
        canonical: { body: expect.stringContaining(`/note-assets/${stored.id}/image.png`) },
      },
    );
    expect(invoke.mock.calls.filter(([command]) => command === "notes_save_image")).toHaveLength(1);
    expect(openDialog).toHaveBeenCalledOnce();
    data.release();
  } finally {
    await act(async () => selected.resolve([]));
  }
});

it("keeps exact private tags through actual Escape, visible Copy/Open recovery, and two remount generations without applying them", async () => {
  function Owner() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      const show = () => setOpen(true);
      window.addEventListener(OPEN_NOTE_LIBRARY_EVENT, show);
      return () => window.removeEventListener(OPEN_NOTE_LIBRARY_EVENT, show);
    }, []);
    return createElement(
      Fragment,
      null,
      open
        ? createElement(NotesView, {
            cwd: "/repo/project",
            recents: [{ path: "/repo/project", openedAt: 1 }],
            onClose: () => setOpen(false),
          })
        : createElement("span", null, "Ordinarily dismissed"),
      createElement(NoteDraftRecoveryNotice),
    );
  }
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    await act(async () => root.render(createElement(Owner)));
    await vi.waitFor(() =>
      expect(host.querySelector('input[aria-label="Add note tag"]')).not.toBeNull(),
    );
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Add note tag"]')!;
    const original = "  \t private raw 漢🦀  ";
    await input(field, original);
    const gate = close();
    const before = await gate.capture();
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(host.textContent).toContain("Ordinarily dismissed");
    expect(gate.current()).toBe(false);
    expect(before.current()).toBe(false);
    await act(async () =>
      Promise.allSettled([...noteSaveQueues.values()].map((queue) => queue.pending)),
    );
    expect(document.body.textContent).toContain("Retained note input");
    const recovery = [
      ...document.querySelectorAll<HTMLElement>("[data-note-private-recovery]"),
    ].find((row) => row.querySelector<HTMLTextAreaElement>("textarea")?.value === original)!;
    expect(recovery).toBeTruthy();
    const recoveryButton = (label: string) =>
      [...recovery.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent?.trim() === label,
      )!;
    await act(async () => recoveryButton("Copy exact text").click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(original);
    expect(document.body.textContent).toContain("Exact text copied");
    before.release();
    await act(async () => gate.release());
    await act(async () => recoveryButton("Open note").click());
    await vi.waitFor(() =>
      expect(host.querySelector('input[aria-label="Add note tag"]')).not.toBeNull(),
    );
    const replacement = host.querySelector<HTMLInputElement>('input[aria-label="Add note tag"]')!;
    expect(replacement.value).toBe("");
    const remounted = await ready();
    expect(remounted.snapshots.flatMap((row) => row.snapshot.inputs ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "tag-input",
          draft: original,
          mounted: false,
          unapplied: true,
        }),
        expect.objectContaining({ source: "tag-input", draft: "", mounted: true }),
      ]),
    );
    remounted.release();
    await input(replacement, "second independent private input");
    await act(async () =>
      replacement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    await act(async () =>
      Promise.allSettled([...noteSaveQueues.values()].map((queue) => queue.pending)),
    );
    const after = await ready();
    const retained = (
      after.snapshots.find((row) => row.snapshot.noteId === stored.id)!.snapshot.inputs as Record<
        string,
        unknown
      >[]
    ).filter((entry) => entry.source === "tag-input");
    expect(retained.map((entry) => entry.draft)).toEqual([
      original,
      "second independent private input",
    ]);
    expect(new Set(retained.map((entry) => entry.generation)).size).toBe(2);
    after.release();
    expect(
      invoke.mock.calls.some(([command]) =>
        ["notes_upsert", "notes_save_image", "notes_delete"].includes(command),
      ),
    ).toBe(false);
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("retains an empty unsubmitted session title on actual view retirement without saving or restoring a new owner's field", async () => {
  await render(true);
  const baseline = await ready();
  baseline.release();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label^="Note title:"]')!.click(),
  );
  const fields = host.querySelectorAll<HTMLInputElement>('input[aria-label="Note title"]');
  await input(fields[fields.length - 1], "");
  await act(async () => root.render(createElement(NoteDraftRecoveryNotice)));
  await act(async () =>
    Promise.allSettled([...noteSaveQueues.values()].map((queue) => queue.pending)),
  );
  const data = await ready();
  expect(data.snapshots.flatMap((row) => row.snapshot.inputs ?? [])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "inline-edit",
        draft: "",
        value: stored.title,
        mounted: false,
        unapplied: true,
      }),
    ]),
  );
  expect(document.body.textContent).toContain("Retained note input");
  expect(document.body.textContent).toContain("Empty input");
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  data.release();
});

it("refuses an oversized private paste and a direct filter:false CM document before mutation or Native effects", async () => {
  await render();
  const baseline = await ready();
  baseline.release();
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Add note tag"]')!;
  await input(field, "existing exact raw");
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { getData: () => "x".repeat(1024 * 1024 + 1) },
  });
  act(() => field.dispatchEvent(paste));
  expect(paste.defaultPrevented).toBe(true);
  expect(field.value).toBe("existing exact raw");
  const view = source();
  const original = view.state.doc.toString();
  act(() =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "x".repeat(8 * 1024 * 1024 + 1) },
      filter: false,
    }),
  );
  expect(view.state.doc.toString()).toBe(original);
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
});

it("holds a new same-key Tag generation before input/effects while the original real async callback still owns its retired port", async () => {
  const owner = new NoteInputOwner(() => ({
    surface: "library",
    noteId: stored.id,
    canonical: stored,
  }));
  const original = deferred<void>();
  const firstChange = vi.fn(() => original.promise);
  const newChange = vi.fn();
  const props = {
    label: "Generation tags",
    inputProps: { "aria-label": "Generation tags" },
    inputObserver: owner.observer("tags"),
  };
  try {
    await act(async () =>
      root.render(
        createElement(TagInput, { ...props, key: "original", onValueChange: firstChange }),
      ),
    );
    const first = host.querySelector<HTMLInputElement>("input")!;
    await input(first, "original accepted callback");
    await act(async () =>
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(firstChange).toHaveBeenCalledExactlyOnceWith(["original accepted callback"]);
    await act(async () =>
      root.render(
        createElement(TagInput, { ...props, key: "replacement", onValueChange: newChange }),
      ),
    );
    const replacement = host.querySelector<HTMLInputElement>("input")!;
    expect(owner.canRetainText("tags", "x".repeat(1024 * 1024))).toBe(false);
    const before = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "new",
      bubbles: true,
      cancelable: true,
    });
    replacement.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await act(async () =>
      replacement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(newChange).not.toHaveBeenCalled();
    expect(replacement.value).toBe("");
    await act(async () => original.resolve());
    await input(replacement, "new original after actual settlement");
    await act(async () =>
      replacement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(newChange).toHaveBeenCalledExactlyOnceWith(["new original after actual settlement"]);
    expect(firstChange).toHaveBeenCalledOnce();
  } finally {
    await act(async () => original.resolve());
    await act(async () => root.render(null));
    owner.retire();
  }
});

it("preserves unadmitted native title/body callbacks, invalidates the cut and holds blur/autosave until a new admitted edit", async () => {
  await render(true);
  const baseline = await ready();
  baseline.release();
  const title = host.querySelector<HTMLInputElement>('input[aria-label="Note title"]')!;
  const body = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')!;
  const gate = close();
  const before = await gate.capture();
  await input(title, "  exact unadmitted title  ");
  await input(body, "exact unadmitted body\n漢🦀");
  expect(title.value).toBe("  exact unadmitted title  ");
  expect(body.value).toBe("exact unadmitted body\n漢🦀");
  expect(gate.current()).toBe(false);
  expect(before.current()).toBe(false);
  before.release();
  await act(async () => gate.release());
  await act(async () => {
    title.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    body.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  const data = await ready();
  expect(
    data.snapshots
      .filter((row) => row.snapshot.noteId === stored.id)
      .map((row) => row.snapshot.unadmittedInputs),
  ).toEqual(expect.arrayContaining([["title"], ["body"]]));
  data.release();
});

it("preserves an oversized direct native body callback as unadmitted data without a Native effect or implicit blur retry", async () => {
  await render(true);
  const baseline = await ready();
  baseline.release();
  const body = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')!;
  const raw = "x".repeat(8 * 1024 * 1024 + 1);
  await input(body, raw);
  expect(body.value).toBe(raw);
  await act(async () => body.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  await act(async () => root.render(null));
  await act(async () =>
    Promise.allSettled([...noteSaveQueues.values()].map((queue) => queue.pending)),
  );
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  const data = await ready();
  expect(
    data.snapshots.find((row) => row.snapshot.sourceSurface === "session-dock")!.snapshot,
  ).toMatchObject({
    canonical: { body: raw },
    unadmittedInputs: ["body"],
  });
  data.release();
});
