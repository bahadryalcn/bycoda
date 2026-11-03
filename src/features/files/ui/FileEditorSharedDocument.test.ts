// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FILE_EDITOR_AUTOSAVE_DELAY_MS, FileEditor } from "./FileEditor";
import { invalidateWatchedFiles } from "../model/fileWatch";
import { sharedUndo } from "../editor/editorSharedHistory";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: (command: string, args?: unknown) => bridge.invoke(command, args),
}));

const PATH = "/repo/index.js";
let root: Root;
let container: HTMLDivElement;
let disk: string;
let writes: string[];
const onDirtyChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "1");
  storage.setItem("bycoda.formatOnSave", "0");
  vi.stubGlobal("localStorage", storage);
  disk = "const a = 1;\r\n";
  writes = [];
  onDirtyChange.mockReset();
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "read_text_file") return disk;
    if (command === "write_text_file") {
      disk = args.content;
      writes.push(args.content);
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

/** The file's own tab and a second tab on the same file, both mounted. */
async function renderBoth() {
  const editor = (documentId: string) =>
    createElement(
      "div",
      { "data-tab": documentId },
      createElement(FileEditor, {
        path: PATH,
        documentId,
        cwd: "/repo",
        active: false,
        onDirtyChange,
      }),
    );
  await act(async () =>
    root.render(createElement("div", null, editor("file-tab"), editor("review-tab"))),
  );
  const view = (documentId: string) =>
    EditorView.findFromDOM(
      container.querySelector<HTMLElement>(`[data-tab="${documentId}"] .cm-editor`)!,
    )!;
  return { file: view("file-tab"), review: view("review-tab") };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, FILE_EDITOR_AUTOSAVE_DELAY_MS + 150));
    invalidateWatchedFiles([PATH]);
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}

function tab(documentId: string) {
  return container.querySelector<HTMLElement>(`[data-tab="${documentId}"]`)!.textContent ?? "";
}

it("shows, saves once and undoes an edit across two tabs of one file", async () => {
  const { file, review } = await renderBoth();

  act(() =>
    file.dispatch({ changes: { from: 12, insert: " // edited" }, userEvent: "input.type" }),
  );
  expect(review.state.doc.toString()).toBe("const a = 1; // edited\n");
  // Both tabs show the shared draft as unsaved until the typing tab saves it.
  expect(tab("file-tab")).toContain("Unsaved changes");
  expect(tab("review-tab")).toContain("Unsaved changes");
  await settle();

  expect(writes).toEqual(["const a = 1; // edited\r\n"]);
  for (const id of ["file-tab", "review-tab"]) {
    expect(tab(id)).not.toContain("Unsaved changes");
    expect(tab(id)).not.toMatch(/changed on disk/i);
  }

  act(() => {
    expect(sharedUndo(review)).toBe(true);
  });
  expect(review.state.doc.toString()).toBe("const a = 1;\n");
  expect(file.state.doc.toString()).toBe("const a = 1;\n");
  await settle();

  expect(writes).toEqual(["const a = 1; // edited\r\n", "const a = 1;\r\n"]);
  for (const id of ["file-tab", "review-tab"]) {
    expect(tab(id)).not.toContain("Unsaved changes");
    expect(tab(id)).not.toMatch(/changed on disk/i);
  }
  expect(onDirtyChange).toHaveBeenLastCalledWith(PATH, false);
});
