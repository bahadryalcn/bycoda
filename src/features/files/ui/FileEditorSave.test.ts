// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: (command: string, args?: unknown) => bridge.invoke(command, args),
}));

let root: Root;
let container: HTMLDivElement;
let disk: string;
const onDirtyChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  storage.setItem("bycoda.formatOnSave", "0");
  vi.stubGlobal("localStorage", storage);
  disk = "original\r\n";
  onDirtyChange.mockReset();
  bridge.invoke.mockReset();
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
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(active = true, path = "/repo/save.txt") {
  await act(async () =>
    root.render(
      createElement(FileEditor, {
        path,
        cwd: "/repo",
        active,
        onDirtyChange,
      }),
    ),
  );
  return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
}

function saveButton() {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === "Save")!;
}

function shortcut(target: EventTarget, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "s",
    code: "KeyS",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

it("saves from the visible action and marks the buffer clean", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "edited " } }));
  expect(container.textContent).toContain("Unsaved changes");
  await act(async () => saveButton().click());
  expect(disk).toBe("edited original\r\n");
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", false);
  expect(container.textContent).toContain("Saved");
});

it("saves from Explorer focus, handles physical keys, and leaves other inputs alone", async () => {
  const view = await render();
  const explorer = document.createElement("button");
  explorer.setAttribute("data-explorer-root", "");
  const composer = document.createElement("textarea");
  document.body.append(explorer, composer);
  try {
    act(() => view.dispatch({ changes: { from: 0, insert: "tree " } }));
    await act(async () => {
      expect(shortcut(composer).defaultPrevented).toBe(false);
    });
    expect(disk).toBe("original\r\n");
    await act(async () => {
      expect(shortcut(explorer, { key: "ş" }).defaultPrevented).toBe(true);
    });
    expect(disk).toBe("tree original\r\n");
    await render(false);
    act(() => view.dispatch({ changes: { from: 0, insert: "hidden " } }));
    await act(async () => {
      expect(shortcut(explorer).defaultPrevented).toBe(false);
    });
    expect(disk).toBe("tree original\r\n");
  } finally {
    explorer.remove();
    composer.remove();
  }
});

it("does not save twice when CodeMirror already handled Ctrl+S", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "once " } }));
  await act(async () => {
    expect(shortcut(view.contentDOM).defaultPrevented).toBe(true);
  });
  expect(
    bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
  ).toHaveLength(1);
});

it("coalesces toolbar and Explorer saves while a write is pending", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "pending " } }));
  const original = bridge.invoke.getMockImplementation()!;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "write_text_file") await pending;
    return original(command, args);
  });
  await act(async () => {
    saveButton().click();
    shortcut(document.body);
    shortcut(document.body, { repeat: true });
  });
  expect(
    bridge.invoke.mock.calls.filter(([command]) => command === "write_text_file"),
  ).toHaveLength(1);
  // Further typing during a write must stay dirty after that snapshot is saved.
  act(() => view.dispatch({ changes: { from: 0, insert: "later " } }));
  await act(async () => finish());
  expect(disk).toBe("pending original\r\n");
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", true);
  expect(container.querySelector("footer [role=status]")?.textContent).toBe("Unsaved changes");
  await act(async () => saveButton().click());
  expect(disk).toBe("later pending original\r\n");
});

it("keeps failed edits dirty and allows retry through the save action", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "retry " } }));
  const original = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "write_text_file") throw new Error("Disk full");
    return original(command, args);
  });
  await act(async () => saveButton().click());
  expect(container.textContent).toContain("Save failed: Disk full");
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", true);
  bridge.invoke.mockImplementation(original);
  await act(async () => saveButton().click());
  expect(disk).toBe("retry original\r\n");
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", false);
});

it("updates Markdown preview from the edited buffer and saves while preview is open", async () => {
  const view = await render(true, "/repo/save.md");
  const modeButton = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text)!;
  await act(async () => modeButton("Source").click());
  act(() => view.dispatch({ changes: { from: 0, insert: "updated " } }));
  await act(async () => modeButton("Preview").click());
  expect(container.querySelector("[data-markdown-view-active]")?.textContent).toContain(
    "updated original",
  );
  await act(async () => {
    expect(shortcut(modeButton("Preview")).defaultPrevented).toBe(true);
  });
  expect(disk).toBe("updated original\r\n");
});
