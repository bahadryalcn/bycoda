import { undo } from "@codemirror/commands";
// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: async () => [],
}));

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
