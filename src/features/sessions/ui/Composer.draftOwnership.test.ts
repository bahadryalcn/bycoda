// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { clearComposerDraft, getComposerDraft, setComposerDraft } from "../model/draftCache";
import type { Attachment } from "../model/session";

const picker = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: picker.read,
}));

let container: HTMLDivElement;
let root: Root;
let submit: ReturnType<typeof vi.fn>;
let save: ReturnType<typeof vi.fn>;
const id = "composer-draft-ownership";
const file: Attachment = {
  id: "picked",
  name: "selected.txt",
  kind: "file",
  mimeType: "text/plain",
  size: 4,
  path: "/fake/selected.txt",
};

async function draw(props: Record<string, unknown> = {}) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        sessionId: id,
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        initialDraft: "Keep the selected file",
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: submit,
        onSaveDraft: save,
        canSaveDraft: true,
        onDraftChange: (text) => setComposerDraft(id, text),
        ...props,
      }),
    ),
  );
}
async function click(label: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );
}
async function choose(description: string) {
  await click("Add files or choose a mode");
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(description),
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  picker.read.mockReset();
  submit = vi.fn();
  save = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearComposerDraft(id);
  vi.unstubAllGlobals();
});

it("publishes each typed draft once while preserving immediate owner updates", async () => {
  const onDraftChange = vi.fn();
  await draw({ onDraftChange });
  onDraftChange.mockClear();
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      "one edit",
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith("one edit");
  });
  expect(onDraftChange).toHaveBeenCalledTimes(1);
});

it("waits for a pending picker and includes its file in the original Send", async () => {
  let finish!: (files: Attachment[]) => void;
  picker.read.mockReturnValue(
    new Promise<Attachment[]>((resolve) => {
      finish = resolve;
    }),
  );
  await draw();
  await choose("Attach files or images");
  await click("Send");
  expect(submit).not.toHaveBeenCalled();
  await act(async () => finish([file]));
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0][1]).toEqual([file]);
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(container.querySelector('[aria-label="Remove selected.txt"]')).toBeNull();
});

it("retires picker results and a waiting Send when the draft is reset", async () => {
  let finish!: (files: Attachment[]) => void;
  picker.read.mockReturnValue(
    new Promise<Attachment[]>((resolve) => {
      finish = resolve;
    }),
  );
  await draw();
  await choose("Attach files or images");
  await click("Send");
  await draw({ initialDraft: "", draftResetToken: 1 });
  await act(async () => finish([file]));
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(container.querySelector('[aria-label="Remove selected.txt"]')).toBeNull();
});

it("retains text and cancels a waiting Send when file inspection fails", async () => {
  let fail!: (reason: Error) => void;
  picker.read.mockReturnValue(
    new Promise<Attachment[]>((_resolve, reject) => {
      fail = reject;
    }),
  );
  await draw();
  await choose("Attach files or images");
  await click("Send");
  await act(async () => fail(new Error("Selected file cannot be read")));
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("Keep the selected file");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("cannot be read");
});

it("restores the Save draft intent through the real cache after remount", async () => {
  await draw();
  await choose("Save this message without starting the agent");
  const text = getComposerDraft(id);
  act(() => root.unmount());
  root = createRoot(container);
  await draw({ initialDraft: text });
  await click("Save draft");
  expect(save).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it("does not convert a restored Save draft intent into Send when saving is unavailable", async () => {
  await draw();
  await choose("Save this message without starting the agent");
  act(() => root.unmount());
  root = createRoot(container);
  await draw({ initialDraft: getComposerDraft(id), canSaveDraft: false, onSaveDraft: undefined });
  await click("Save draft");
  expect(save).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
});
