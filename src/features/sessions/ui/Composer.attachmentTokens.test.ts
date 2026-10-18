// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async () => () => undefined,
  }),
}));

let container: HTMLDivElement;
let root: Root;
let submit: ReturnType<typeof vi.fn>;
/** What a file manager would have put on the native clipboard. */
let clipboardPaths: string[];

function render(text = "") {
  act(() => {
    root.render(
      createElement(Composer, {
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        hideTopBar: true,
        initialDraft: text,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: submit,
      }),
    );
  });
  return container.querySelector("textarea")!;
}

/** Pastes files the way a file manager copy arrives: as no text at all. */
async function pasteFiles(field: HTMLTextAreaElement, ...paths: string[]) {
  const before = chipCount();
  clipboardPaths = paths;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => "", files: [], items: [] },
  });
  act(() => {
    field.dispatchEvent(event);
  });
  for (let waited = 0; waited < 2000; waited += 10) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (chipCount() === before + paths.length) return;
  }
  throw new Error("Timed out waiting for the attachments.");
}

function chipCount() {
  return container.querySelectorAll('[aria-label^="Remove "]').length;
}

function chipLabels() {
  return [...container.querySelectorAll<HTMLButtonElement>('[aria-label^="Insert "]')].map(
    (button) => button.getAttribute("aria-label")?.match(/\[([^\]]+)\]/)?.[1],
  );
}

function type(field: HTMLTextAreaElement, value: string) {
  act(() => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A user edit: the browser fires `beforeinput` ahead of the text change. */
function userType(field: HTMLTextAreaElement, value: string, inputType = "insertText") {
  act(() => {
    const before = new Event("beforeinput", {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(before, { inputType });
    if (field.dispatchEvent(before)) {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function click(selector: string) {
  act(() => {
    container.querySelector<HTMLButtonElement>(selector)!.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  submit = vi.fn();
  clipboardPaths = [];
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args?: { paths?: string[] }) => {
    if (command === "clipboard_file_paths") return clipboardPaths;
    if (command === "read_file_base64") return "YWJj";
    if (command === "inspect_paths")
      return (args?.paths ?? []).map((path) => ({
        path,
        name: path.split("/").pop() ?? path,
        size: 3,
        isDir: false,
      }));
    return [];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("inserts the token at the caret when the input has focus", async () => {
  const field = render("The button in the  I gave you");
  field.focus();
  field.setSelectionRange(18, 18);
  await pasteFiles(field, "/p/a.png");

  expect(field.value).toBe("The button in the [image1] I gave you");
  expect(field.selectionStart).toBe(field.value.indexOf("[image1]") + 8);
  expect(chipLabels()).toEqual(["image1"]);
});

it("replaces the selection and numbers kinds separately", async () => {
  const field = render("fix THIS now");
  field.focus();
  field.setSelectionRange(4, 8);
  await pasteFiles(field, "/p/a.png", "/p/notes.md");

  expect(field.value).toBe("fix [image1] [file1] now");
  expect(chipLabels()).toEqual(["image1", "file1"]);
});

it("appends at the end when the input is not focused", async () => {
  const field = render("look");
  field.setSelectionRange(0, 0);
  await pasteFiles(field, "/p/a.png");
  field.blur();
  await pasteFiles(field, "/p/b.png");

  expect(field.value).toBe("look [image1] [image2]");
});

it("keeps the chip when its token is deleted by hand", async () => {
  const field = render("");
  await pasteFiles(field, "/p/a.png");
  type(field, "no mention");

  expect(chipCount()).toBe(1);
  expect(chipLabels()).toEqual(["image1"]);
});

it("removes the attachment when the user deletes its token and renumbers the rest", async () => {
  const field = render("");
  await pasteFiles(field, "/p/a.png", "/p/b.png");
  expect(field.value).toBe("[image1] [image2]");

  userType(field, " [image2]", "deleteByCut");

  expect(field.value).toBe(" [image1]");
  expect(chipLabels()).toEqual(["image1"]);
  expect(container.querySelector('[aria-label="Remove b.png"]')).not.toBeNull();
});

it("removes every attachment on select-all delete", async () => {
  const field = render("");
  await pasteFiles(field, "/p/a.png", "/p/notes.md");
  field.setSelectionRange(0, field.value.length);

  userType(field, "", "deleteContentBackward");

  expect(chipCount()).toBe(0);
});

it("Backspace after a token removes the whole token and its attachment", async () => {
  const field = render("hi ");
  await pasteFiles(field, "/p/a.png");
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  expect(field.value).toBe("hi [image1]");

  userType(field, "hi [image1", "deleteContentBackward");

  expect(field.value).toBe("hi ");
  expect(chipCount()).toBe(0);
});

it("keeps the attachment when text changes elsewhere or programmatically", async () => {
  const field = render("");
  await pasteFiles(field, "/p/a.png");

  userType(field, "x[image1] more");
  expect(chipCount()).toBe(1);
  type(field, "replaced by recall");
  expect(chipCount()).toBe(1);
});

it("inserts the token again when its label is clicked", async () => {
  const field = render("see");
  await pasteFiles(field, "/p/a.png");
  type(field, "see [image1] and");
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  click('[aria-label="Insert [image1] into the message"]');

  expect(field.value).toBe("see [image1] and [image1]");
});

it("removes the token and renumbers the rest when a chip is removed", async () => {
  const field = render("");
  await pasteFiles(field, "/p/a.png", "/p/b.png");
  type(field, "[image1] is broken, [image2] is fine, [image1] again");

  click('[aria-label="Remove a.png"]');

  expect(field.value).toBe("is broken, [image1] is fine, again");
  expect(chipLabels()).toEqual(["image1"]);
  expect(container.querySelector('[aria-label="Remove b.png"]')).not.toBeNull();
});

it("sends the tokens in the text with the attachments in the order added", async () => {
  const field = render("");
  await pasteFiles(field, "/p/a.png");
  await pasteFiles(field, "/p/b.png");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click(),
  );

  expect(submit.mock.calls[0][0]).toBe("[image1] [image2]");
  expect(submit.mock.calls[0][1].map((file: { name: string }) => file.name)).toEqual([
    "a.png",
    "b.png",
  ]);
});
