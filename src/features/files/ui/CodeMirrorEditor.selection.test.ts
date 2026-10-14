// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let view: EditorView;
const added = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  vi.stubGlobal("localStorage", storage);
  added.mockReset();
  window.addEventListener(ADD_TO_CHAT_EVENT, added);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(CodeMirrorEditor, {
        path: "/repo/src/value.ts",
        cwd: "/repo",
        commentPath: "src/value.ts",
        value: "first\nsecond\nthird",
        showDiff: false,
        gitOriginal: null,
        active: true,
        onSave: vi.fn(),
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
  window.removeEventListener(ADD_TO_CHAT_EVENT, added);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function shortcut() {
  const event = new KeyboardEvent("keydown", {
    key: "l",
    code: "KeyL",
    keyCode: 76,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    view.contentDOM.dispatchEvent(event);
  });
  return event;
}

it("adds the current selection as a plain file reference with Ctrl+L", async () => {
  act(() => view.dispatch({ selection: { anchor: 0, head: 13 } }));
  expect((await shortcut()).defaultPrevented).toBe(true);
  expect(added).toHaveBeenCalledTimes(1);
  expect(added.mock.calls[0][0].detail).toEqual({
    text: "@src/value.ts (lines 1-2)",
    mode: "plain",
  });
  expect(view.state.doc.toString()).toBe("first\nsecond\nthird");
});

it("does not intercept Ctrl+L for a cursor or whitespace", async () => {
  expect((await shortcut()).defaultPrevented).toBe(false);
  act(() => view.dispatch({ selection: { anchor: 5, head: 6 } }));
  expect((await shortcut()).defaultPrevented).toBe(false);
  expect(added).not.toHaveBeenCalled();
});

it("shows the action after measurement and adds the same reference on click", async () => {
  vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 30, right: 31, top: 30, bottom: 44 });
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 500, 500));
  await act(async () => {
    view.dispatch({ selection: { anchor: 0, head: 13 } });
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  const toolbar = document.querySelector('[role="toolbar"]');
  expect(toolbar).not.toBeNull();
  const button = toolbar!.querySelector("button")!;
  expect(button.textContent).toContain("Ctrl+L");
  await act(async () => button.click());
  expect(added.mock.calls[0][0].detail).toEqual({
    text: "@src/value.ts (lines 1-2)",
    mode: "plain",
  });
  expect(document.querySelector('[role="toolbar"]')).toBeNull();
});
