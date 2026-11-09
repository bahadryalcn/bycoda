import { undo } from "@codemirror/commands";
// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CodeMirrorEditor, type EditorCarry } from "./CodeMirrorEditor";
import { message } from "@tauri-apps/plugin-dialog";
import { prepareEditorsToClose } from "../model/editorClose";
import type { Text } from "@codemirror/state";

vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: async () => [],
}));

it("keeps the current document across actual child replacement instead of replaying an old recovery value", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  vi.stubGlobal("localStorage", storage);
  const host = document.createElement("div");
  const root = createRoot(host);
  const retainedState = { current: null as EditorCarry | null };
  const dirty = vi.fn();
  const saveRequestRef = { current: null as (() => Promise<boolean>) | null };
  const onSave = vi.fn(async () => {});
  const props = {
    path: "/repo/recovered.txt",
    cwd: "/repo",
    commentPath: "recovered.txt",
    value: "baseline",
    initialDraft: "recovered A",
    initialDirty: true,
    showDiff: false,
    gitOriginal: null,
    active: false,
    onDirtyChange: dirty,
    onErrorCountChange: vi.fn(),
    onSave,
    canAutosave: () => false,
    formatOnSave: false,
    saveRequestRef,
    retainedState,
  };
  try {
    await act(async () => root.render(createElement(CodeMirrorEditor, { ...props, key: "first" })));
    const first = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    act(() =>
      first.dispatch({ changes: { from: first.state.doc.length, insert: " plus newer B" } }),
    );
    await act(async () =>
      root.render(createElement(CodeMirrorEditor, { ...props, key: "replacement" })),
    );
    const second = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    expect(second).not.toBe(first);
    expect(second.state.doc.toString()).toBe("recovered A plus newer B");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => {
      expect(await saveRequestRef.current!()).toBe(true);
    });
    expect(onSave).toHaveBeenCalledWith("recovered A plus newer B");
    expect(dirty).toHaveBeenLastCalledWith(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("admits immutable documents synchronously and preserves recovered edits against their disk baseline", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "1");
  storage.setItem("bycoda.formatOnSave", "0");
  vi.stubGlobal("localStorage", storage);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const captures: Text[] = [];
  const dirty = vi.fn();
  let finishWrite!: () => void;
  const onSave = vi.fn(() => new Promise<void>((resolve) => (finishWrite = resolve)));
  const saveRequestRef = { current: null as (() => Promise<boolean>) | null };
  const props = {
    path: "/repo/recovered.txt",
    cwd: "/repo",
    commentPath: "recovered.txt",
    value: "disk baseline\n",
    initialDraft: "recovered edits\n",
    showDiff: false,
    gitOriginal: null,
    active: false,
    onDirtyChange: dirty,
    onErrorCountChange: vi.fn(),
    onSave,
    saveRequestRef,
    canAutosave: () => false,
    formatOnSave: false,
    onDocumentChange: (document: Text) => captures.push(document),
  };
  try {
    await act(async () => root.render(createElement(CodeMirrorEditor, props)));
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    expect(view.state.doc.toString()).toBe("recovered edits\n");
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "first " } });
      expect(captures).toHaveLength(1);
      expect(captures[0]).toBe(view.state.doc);
      view.dispatch({ changes: { from: 0, insert: "second " } });
      expect(captures[0].toString()).toBe("first recovered edits\n");
      expect(captures[1].toString()).toBe("second first recovered edits\n");
    });
    await act(async () =>
      root.render(createElement(CodeMirrorEditor, { ...props, value: "changed disk\n" })),
    );
    expect(view.state.doc.toString()).toBe("second first recovered edits\n");
    let saving!: Promise<boolean>;
    act(() => {
      saving = saveRequestRef.current!();
    });
    expect(onSave).toHaveBeenCalledWith("second first recovered edits\n");
    act(() => view.dispatch({ changes: { from: 0, insert: "later " } }));
    await act(async () => {
      finishWrite();
      expect(await saving).toBe(true);
    });
    expect(view.state.doc.toString()).toBe("later second first recovered edits\n");
    expect(dirty).toHaveBeenLastCalledWith(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("retains editor, edits, selection and undo across inline diff and formatting toggles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.diffLayout", "unified");
  storage.setItem("bycoda.autosave", "0");
  vi.stubGlobal("localStorage", storage);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props = {
    path: "/repo/a.txt",
    cwd: "/repo",
    commentPath: "a.txt",
    value: "original\n",
    gitOriginal: "original\n",
    active: false,
    onDirtyChange: vi.fn(),
    onErrorCountChange: vi.fn(),
    onSave: vi.fn(async () => {}),
    canAutosave: () => false,
  };
  try {
    await act(async () =>
      root.render(
        createElement(CodeMirrorEditor, { ...props, showDiff: false, formatOnSave: false }),
      ),
    );
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: 0, insert: "edit " }, selection: { anchor: 5 } }));
    const doc = view.state.doc.toString();
    const head = view.state.selection.main.head;
    await act(async () =>
      root.render(
        createElement(CodeMirrorEditor, { ...props, showDiff: true, formatOnSave: true }),
      ),
    );
    expect(EditorView.findFromDOM(host.querySelector(".cm-editor")!)).toBe(view);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(head);
    await act(async () =>
      root.render(
        createElement(CodeMirrorEditor, { ...props, showDiff: false, formatOnSave: false }),
      ),
    );
    expect(EditorView.findFromDOM(host.querySelector(".cm-editor")!)).toBe(view);
    expect(view.state.doc.toString()).toBe(doc);
    act(() => {
      expect(undo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe("original\n");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("preserves manual edits on close cancellation and save failure, then saves on retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  vi.stubGlobal("localStorage", storage);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSave = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
  try {
    await act(async () =>
      root.render(
        createElement(CodeMirrorEditor, {
          path: "/repo/manual.txt",
          cwd: "/repo",
          value: "original",
          showDiff: false,
          gitOriginal: "original",
          active: false,
          onDirtyChange: vi.fn(),
          onErrorCountChange: vi.fn(),
          onSave,
          canAutosave: () => false,
          formatOnSave: false,
        }),
      ),
    );
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: 0, insert: "edit " } }));
    vi.mocked(message).mockResolvedValue("Cancel");
    expect(await prepareEditorsToClose()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    vi.mocked(message).mockResolvedValue("Save");
    await expect(prepareEditorsToClose()).rejects.toThrow("Could not save");
    expect(view.state.doc.toString()).toBe("edit original");
    expect(await prepareEditorsToClose()).toBe(true);
    expect(onSave).toHaveBeenLastCalledWith("edit original");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
