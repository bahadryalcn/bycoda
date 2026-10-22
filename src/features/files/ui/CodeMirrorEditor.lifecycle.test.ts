import { undo } from "@codemirror/commands";
// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { message } from "@tauri-apps/plugin-dialog";
import { prepareEditorsToClose } from "../model/editorClose";

vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));

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
