// @vitest-environment happy-dom
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

const format = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/lib/format", () => ({ formatProjectText: format }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let view: EditorView;
const onSave = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  vi.stubGlobal("localStorage", storage);
  format.mockReset();
  onSave.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(CodeMirrorEditor, {
        path: "/repo/Page.tsx",
        cwd: "/repo",
        commentPath: "Page.tsx",
        value: "const Page=()=> <div/>;",
        showDiff: false,
        gitOriginal: null,
        active: true,
        formatOnSave: false,
        onSave,
        onDirtyChange: vi.fn(),
        onErrorCountChange: vi.fn(),
        canAutosave: () => false,
      }),
    ),
  );
  view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function shortcut() {
  const event = new KeyboardEvent("keydown", {
    key: "F",
    code: "KeyF",
    keyCode: 70,
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    view.contentDOM.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}
it("formats with Alt+Shift+F despite format-on-save being disabled, without saving, and supports undo", async () => {
  const original = view.state.doc.toString();
  format.mockResolvedValue({ formatted: "const Page = () => <div />;\n", cursorOffset: 10 });
  await shortcut();
  expect(format).toHaveBeenCalledWith("/repo/Page.tsx", original, 0);
  expect(view.state.doc.toString()).toBe("const Page = () => <div />;\n");
  expect(view.state.selection.main.head).toBe(10);
  expect(onSave).not.toHaveBeenCalled();
  act(() => {
    expect(undo(view)).toBe(true);
  });
  expect(view.state.doc.toString()).toBe(original);
});
it("does not replace edits made while formatting is pending", async () => {
  let finish!: (result: { formatted: string; cursorOffset: number }) => void;
  format.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await shortcut();
  act(() => view.dispatch({ changes: { from: 0, insert: "// new edit\n" } }));
  const edited = view.state.doc.toString();
  await act(async () => finish({ formatted: "old result", cursorOffset: 0 }));
  expect(view.state.doc.toString()).toBe(edited);
});
it("shows formatter errors and leaves the document intact", async () => {
  const original = view.state.doc.toString();
  format.mockRejectedValue(new Error("Invalid Prettier configuration"));
  await shortcut();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Invalid Prettier configuration",
  );
  expect(view.state.doc.toString()).toBe(original);
});
