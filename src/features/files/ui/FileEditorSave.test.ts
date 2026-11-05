// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Chunk } from "@codemirror/merge";
import { undo } from "@codemirror/commands";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FILE_EDITOR_AUTOSAVE_DELAY_MS, FileEditor } from "./FileEditor";
import { invalidateWatchedFiles } from "../model/fileWatch";
import { saveAutosave } from "../../settings/model/settings";

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
        documentId: "stable-tab",
        cwd: "/repo",
        active,
        onDirtyChange,
      }),
    ),
  );
  return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
}

function saveButton() {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Save"]')!;
}

it("treats a path change without an explicit document identity as a different document", async () => {
  const open = (path: string) =>
    act(async () =>
      root.render(createElement(FileEditor, { path, cwd: "/repo", active: true, onDirtyChange })),
    );
  await open("/repo/first.txt");
  const first = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  act(() => first.dispatch({ changes: { from: 0, insert: "first draft " } }));
  disk = "second document\r\n";
  await open("/repo/second.txt");
  const second = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  expect(second.state.doc.toString()).toBe("second document\n");
  expect(second.state.doc.toString()).not.toContain("first draft");
  expect(saveButton().disabled).toBe(true);
});

it("saves an already dirty buffer when autosave is enabled from settings", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "automatic " } }));
  expect(disk).toBe("original\r\n");
  await act(async () => {
    saveAutosave(true);
    await new Promise((resolve) => setTimeout(resolve, FILE_EDITOR_AUTOSAVE_DELAY_MS + 100));
  });
  expect(disk).toBe("automatic original\r\n");
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", false);
});

it.each(["/repo/renamed.txt", "/repo/moved/save.txt", "/renamed-repo/save.txt"])(
  "preserves unsaved document and undo across relocation to %s, then saves at its new path",
  async (path) => {
    const view = await render();
    act(() =>
      view.dispatch({
        changes: { from: 0, insert: "UNSAVED " },
        selection: { anchor: 1, head: 5 },
      }),
    );
    const moved = await render(true, path);
    expect(moved.state.doc.toString()).toBe("UNSAVED original\n");
    expect(moved.state.selection.main.anchor).toBe(1);
    expect(moved.state.selection.main.head).toBe(5);
    expect(container.textContent).toContain("Unsaved changes");
    act(() => {
      expect(undo(moved)).toBe(true);
    });
    expect(moved.state.doc.toString()).toBe("original\n");
    act(() => moved.dispatch({ changes: { from: 0, insert: "new " } }));
    await act(async () => saveButton().click());
    expect(bridge.invoke).toHaveBeenCalledWith(
      "write_text_file",
      expect.objectContaining({ path, content: "new original\r\n" }),
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(path, false);
  },
);

it.each(["original\r\n", "external\r\n"])(
  "reloads clean saved content after an external change to %j",
  async (external) => {
    const view = await render();
    act(() => view.dispatch({ changes: { from: 0, insert: "saved " } }));
    await act(async () => saveButton().click());
    expect(disk).toBe("saved original\r\n");
    disk = external;
    await act(async () => {
      invalidateWatchedFiles(["/repo/save.txt"]);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(view.state.doc.toString()).toBe(external.replaceAll("\r\n", "\n"));
    expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", false);
    act(() => view.dispatch({ changes: { from: 0, insert: "next " } }));
    await act(async () => saveButton().click());
    expect(disk).toBe(`next ${external}`);
  },
);

it("keeps unsaved edits and blocks autosave over externally changed saved content", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "saved " } }));
  await act(async () => saveButton().click());
  localStorage.setItem("bycoda.autosave", "1");
  act(() => view.dispatch({ changes: { from: 0, insert: "dirty " } }));
  disk = "original\r\n";
  await act(async () => invalidateWatchedFiles(["/repo/save.txt"]));
  expect(view.state.doc.toString()).toBe("dirty saved original\n");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, FILE_EDITOR_AUTOSAVE_DELAY_MS + 100));
  });
  expect(disk).toBe("original\r\n");
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", true);
});

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

function conflictAction(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
}

it.each(["button", "shortcut"])(
  "requires an informed overwrite after external edits (%s)",
  async (action) => {
    const view = await render();
    act(() => view.dispatch({ changes: { from: 0, insert: "draft " } }));
    disk = "external\r\n";
    await act(async () => invalidateWatchedFiles(["/repo/save.txt"]));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "File changed on disk",
    );
    expect(view.state.doc.toString()).toBe("draft original\n");
    await act(async () => {
      if (action === "button") saveButton().click();
      else shortcut(view.contentDOM);
    });
    expect(disk).toBe("external\r\n");
    expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", true);
    act(() => view.dispatch({ changes: { from: 0, insert: "latest " } }));
    await act(async () => conflictAction("Overwrite disk version").click());
    expect(disk).toBe("latest draft original\r\n");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", false);
  },
);

it("reloads the external version only after the explicit discard choice", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "draft " } }));
  disk = "external\r\n";
  await act(async () => invalidateWatchedFiles(["/repo/save.txt"]));
  await act(async () => conflictAction("Reload from disk").click());
  const reloaded = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  expect(reloaded.state.doc.toString()).toBe("external\n");
  expect(disk).toBe("external\r\n");
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", false);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("retains newer edits made while the chosen reload is reading", async () => {
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, insert: "draft " } }));
  disk = "external\r\n";
  await act(async () => invalidateWatchedFiles(["/repo/save.txt"]));
  const original = bridge.invoke.getMockImplementation()!;
  let finish!: (content: string) => void;
  bridge.invoke.mockImplementation((command, args) =>
    command === "read_text_file"
      ? new Promise<string>((resolve) => {
          finish = resolve;
        })
      : original(command, args),
  );
  act(() => conflictAction("Reload from disk").click());
  act(() => view.dispatch({ changes: { from: 0, insert: "newer " } }));
  await act(async () => finish("external\r\n"));
  expect(view.state.doc.toString()).toBe("newer draft original\n");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith("/repo/save.txt", true);
});

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

it("retains the same source editor, selection and undo while Preview owns the pane", async () => {
  const view = await render(true, "/repo/retained-preview.md");
  const modeButton = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text)!;
  await act(async () => modeButton("Source").click());
  act(() =>
    view.dispatch({ changes: { from: 0, insert: "draft " }, selection: { anchor: 1, head: 4 } }),
  );
  await act(async () => modeButton("Preview").click());
  const source = container.querySelector<HTMLElement>("[data-file-editor-source-active]")!;
  expect(source.getAttribute("data-file-editor-source-active")).toBe("false");
  expect(source.hasAttribute("inert")).toBe(true);
  expect(EditorView.findFromDOM(source.querySelector<HTMLElement>(".cm-editor")!)).toBe(view);
  expect(view.state.doc.toString()).toBe("draft original\n");
  expect(disk).toBe("original\r\n");

  await act(async () => modeButton("Source").click());
  expect(source.getAttribute("data-file-editor-source-active")).toBe("true");
  expect(source.hasAttribute("inert")).toBe(false);
  expect(view.state.selection.main.anchor).toBe(1);
  expect(view.state.selection.main.head).toBe(4);
  act(() => expect(undo(view)).toBe(true));
  expect(view.state.doc.toString()).toBe("original\n");
});

it("preserves mixed separators through editing, undo and save", async () => {
  disk = "first\r\nsecond\nthird\rfourth\r\n";
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, to: 5, insert: "FIRST" } }));
  await act(async () => saveButton().click());
  expect(disk).toBe("FIRST\r\nsecond\nthird\rfourth\r\n");
  act(() => {
    undo(view);
  });
  await act(async () => saveButton().click());
  expect(disk).toBe("first\r\nsecond\nthird\rfourth\r\n");
});

it("keeps a mixed draft and reports an imprecise diff without writing", async () => {
  disk = "first\r\nsecond\n";
  const view = await render();
  act(() => view.dispatch({ changes: { from: 0, to: 5, insert: "FIRST" } }));
  const build = vi.spyOn(Chunk, "build").mockReturnValue([{ precise: false }] as never);
  try {
    await act(async () => saveButton().click());
    expect(disk).toBe("first\r\nsecond\n");
    expect(view.state.doc.toString()).toBe("FIRST\nsecond\n");
    expect(container.textContent).toContain("Cannot safely preserve mixed line endings");
    expect(saveButton().disabled).toBe(false);
  } finally {
    build.mockRestore();
  }
});
