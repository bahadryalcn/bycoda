// @vitest-environment happy-dom
import { undo } from "@codemirror/commands";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

const format = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/lib/format", () => ({
  formatProjectText: format,
}));
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

async function openMenu(keyboard = false) {
  vi.spyOn(view, "posAtCoords").mockReturnValue(null);
  vi.spyOn(view, "coordsAtPos").mockReturnValue(null);
  const event = keyboard
    ? new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })
    : new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
  await act(async () => {
    view.contentDOM.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
}

it("opens editor actions instead of the native menu and formats the unsaved buffer", async () => {
  format.mockResolvedValue({ formatted: "const Page = () => <div />;", cursorOffset: 0 });
  const items = await openMenu();
  const formatItem = items.find((item) => item.textContent?.includes("Format document"));
  expect(formatItem).toBeDefined();
  await act(async () => formatItem!.click());
  expect(format).toHaveBeenCalledWith("/repo/Page.tsx", "const Page=()=> <div/>;", 0);
  expect(view.state.doc.toString()).toBe("const Page = () => <div />;");
  expect(onSave).not.toHaveBeenCalled();
  act(() => undo(view));
  expect(view.state.doc.toString()).toBe("const Page=()=> <div/>;");
});

it("opens the same menu with Shift+F10 and disables edits for read-only documents", async () => {
  const { EditorState } = await import("@codemirror/state");
  act(() => view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }));
  const items = await openMenu(true);
  for (const name of ["Format document", "Save", "Paste", "Undo", "Cut"]) {
    expect(items.find((item) => item.textContent?.startsWith(name))?.disabled).toBe(true);
  }
  expect(items.find((item) => item.textContent?.startsWith("Find"))?.disabled).toBe(false);
  expect(format).not.toHaveBeenCalled();
});

it("does not delete selected code when copying to the clipboard fails", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard denied"));
  act(() => view.dispatch({ selection: { anchor: 0, head: 5 } }));
  const items = await openMenu();
  await act(async () => items.find((item) => item.textContent?.startsWith("Cut"))!.click());
  expect(view.state.doc.toString()).toBe("const Page=()=> <div/>;");
  expect(host.textContent).toContain("Clipboard denied");
});

it("does not paste over edits made while clipboard access was pending", async () => {
  let resolve!: (text: string) => void;
  vi.spyOn(navigator.clipboard, "readText").mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const items = await openMenu();
  await act(async () => items.find((item) => item.textContent?.startsWith("Paste"))!.click());
  act(() => view.dispatch({ changes: { from: 0, insert: "// new\n" } }));
  await act(async () => resolve("late clipboard"));
  expect(view.state.doc.toString()).toBe("// new\nconst Page=()=> <div/>;");
});

it.each(["unsupported", "exception"])(
  "handles format-on-save %s while preserving a successful source save",
  async (kind) => {
    localStorage.setItem("bycoda.formatOnSave", "1");
    onSave.mockResolvedValue(undefined);
    if (kind === "exception")
      format.mockRejectedValue(new Error("Invalid project formatter configuration"));
    else format.mockResolvedValue(null);
    const saveRequestRef: { current: (() => Promise<boolean>) | null } = { current: null };
    await act(async () =>
      root.render(
        createElement(CodeMirrorEditor, {
          path: "/repo/Page.tsx",
          cwd: "/repo",
          value: "source",
          showDiff: false,
          gitOriginal: null,
          active: true,
          formatOnSave: true,
          onSave,
          onDirtyChange: vi.fn(),
          onErrorCountChange: vi.fn(),
          canAutosave: () => false,
          saveRequestRef,
        }),
      ),
    );
    const editor = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    act(() => editor.dispatch({ changes: { from: 0, insert: "edited " } }));
    await act(async () => {
      expect(await saveRequestRef.current!()).toBe(true);
    });
    expect(onSave).toHaveBeenLastCalledWith("edited source");
    // No project formatter is not a failure; only formatter errors are reported.
    if (kind === "unsupported") expect(host.querySelector('[role="alert"]')).toBeNull();
    else {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "Invalid project formatter",
      );
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "Saved, but formatting failed: ",
      );
    }
  },
);

async function formatOnSaveEditor() {
  localStorage.setItem("bycoda.formatOnSave", "1");
  const saveRequestRef: { current: (() => Promise<boolean>) | null } = { current: null };
  await act(async () =>
    root.render(
      createElement(CodeMirrorEditor, {
        path: "/repo/Page.tsx",
        cwd: "/repo",
        value: "source",
        showDiff: false,
        gitOriginal: null,
        active: true,
        formatOnSave: true,
        onSave,
        onDirtyChange: vi.fn(),
        onErrorCountChange: vi.fn(),
        canAutosave: () => false,
        saveRequestRef,
      }),
    ),
  );
  view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
  return () => saveRequestRef.current!();
}

it("only reports saved with a format warning after disk save succeeds, and clears that claim on edits", async () => {
  let finish!: () => void;
  onSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  format.mockRejectedValue(new Error("NATIVE_DELIVERY_CAPACITY"));
  const save = await formatOnSaveEditor();
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = save();
  });
  expect(host.textContent).toContain("Formatting failed: NATIVE_DELIVERY_CAPACITY");
  expect(host.textContent).not.toContain("Saved, but formatting failed");
  await act(async () => {
    finish();
    expect(await pending).toBe(true);
  });
  expect(host.textContent).toContain("Saved, but formatting failed: NATIVE_DELIVERY_CAPACITY");
  act(() => view.dispatch({ changes: { from: 0, insert: "unsaved " } }));
  expect(host.textContent).not.toContain("Saved, but formatting failed");
});

it("does not claim a saved file when the disk save fails after a formatter failure", async () => {
  onSave.mockRejectedValue(new Error("Disk write denied"));
  format.mockRejectedValue(new Error("NATIVE_DELIVERY_CAPACITY"));
  const save = await formatOnSaveEditor();
  await act(async () => expect(await save()).toBe(false));
  expect(host.textContent).toContain("Formatting failed: NATIVE_DELIVERY_CAPACITY");
  expect(host.textContent).not.toContain("Saved, but formatting failed");
});

it("does not claim newer editor changes were saved when an older save completes", async () => {
  let finish!: () => void;
  onSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  format.mockRejectedValue(new Error("NATIVE_DELIVERY_CAPACITY"));
  const save = await formatOnSaveEditor();
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = save();
  });
  act(() => view.dispatch({ changes: { from: 0, insert: "newer " } }));
  await act(async () => {
    finish();
    expect(await pending).toBe(true);
  });
  expect(onSave).toHaveBeenCalledWith("source");
  expect(host.textContent).not.toContain("Saved, but formatting failed");
});

it("keeps manual formatter failures separate from an earlier successful save", async () => {
  onSave.mockResolvedValue(undefined);
  format.mockRejectedValue(new Error("NATIVE_DELIVERY_CAPACITY"));
  const save = await formatOnSaveEditor();
  await act(async () => expect(await save()).toBe(true));
  expect(host.textContent).toContain("Saved, but formatting failed");
  await shortcut();
  expect(host.textContent).toContain("Formatting failed: NATIVE_DELIVERY_CAPACITY");
  expect(host.textContent).not.toContain("Saved, but formatting failed");
  expect(onSave).toHaveBeenCalledTimes(1);
});

it("does not let a superseded save overwrite a newer failed save outcome", async () => {
  let finish!: () => void;
  onSave
    .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    .mockRejectedValueOnce(new Error("Disk write denied"));
  format.mockRejectedValue(new Error("NATIVE_DELIVERY_CAPACITY"));
  const save = await formatOnSaveEditor();
  let older!: Promise<boolean>;
  await act(async () => {
    older = save();
  });
  await act(async () => expect(await save()).toBe(false));
  await act(async () => {
    finish();
    expect(await older).toBe(true);
  });
  expect(host.textContent).toContain("Formatting failed: NATIVE_DELIVERY_CAPACITY");
  expect(host.textContent).not.toContain("Saved, but formatting failed");
});

it("does not show a stale formatter failure after the document changes", async () => {
  let fail!: (error: Error) => void;
  format.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
  await shortcut();
  act(() => view.dispatch({ changes: { from: 0, insert: "newer " } }));
  await act(async () => fail(new Error("Old format failed")));
  expect(host.textContent).not.toContain("Old format failed");
});
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
  format.mockRejectedValue(new Error("Invalid project formatter configuration"));
  await shortcut();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Invalid project formatter configuration",
  );
  expect(view.state.doc.toString()).toBe(original);
});
