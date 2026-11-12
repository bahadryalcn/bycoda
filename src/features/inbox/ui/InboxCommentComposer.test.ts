// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxCommentForm } from "./InboxComments";
import { isTauri } from "@tauri-apps/api/core";
import { attachmentsFromPaths } from "../../sessions/model/attachments";

const nativeDrop = vi.hoisted(() => ({
  listener: undefined as
    | undefined
    | ((event: {
        payload: { type: string; position: { x: number; y: number }; paths: string[] };
      }) => void),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: typeof nativeDrop.listener) => {
      nativeDrop.listener = listener;
      return () => {
        nativeDrop.listener = undefined;
      };
    },
  }),
}));
vi.mock("../../sessions/model/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sessions/model/attachments")>()),
  attachmentsFromPaths: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../notes/ui/NoteMarkdownEditor", () => ({
  NoteMarkdownEditor: ({
    value,
    onChange,
    onSave,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSave: () => void;
  }) =>
    createElement("textarea", {
      value,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      onKeyDown: (event: { key: string; ctrlKey: boolean }) => {
        if (event.ctrlKey && event.key === "s") onSave();
      },
      "aria-label": "Comment editor",
    }),
  runMarkdownCommand: vi.fn(),
}));

it("retains text and images after failed submission and remount, then clears after success", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const onSubmit = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  const props = {
    draftKey: "jira-preservation",
    target: "Jira",
    replyTo: null,
    posting: false,
    error: null,
    onCancelReply: vi.fn(),
    onSubmit,
  };
  act(() => root.render(createElement(InboxCommentForm, props)));
  const editor = container.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      editor,
      "**keep this draft**",
    );
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const input = container.querySelector('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["png"], "screen.png", { type: "image/png" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(container.querySelector('img[alt="screen.png"]')).not.toBeNull();
  await act(async () => {
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
  });
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(onSubmit).toHaveBeenCalledWith("**keep this draft**", [
    expect.objectContaining({ name: "screen.png" }),
  ]);
  act(() => root.unmount());
  root = createRoot(container);
  act(() => root.render(createElement(InboxCommentForm, props)));
  expect(container.querySelector("textarea")!.value).toBe("**keep this draft**");
  expect(container.querySelector('img[alt="screen.png"]')).not.toBeNull();
  await act(async () => {
    container
      .querySelector("textarea")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  });
  expect(onSubmit).toHaveBeenCalledTimes(2);
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(container.querySelector("img")).toBeNull();
  act(() => root.unmount());
  container.remove();
});

it("admits native file drops only inside the editor and supports image-only comments", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(attachmentsFromPaths).mockResolvedValue([
    {
      id: "native-image",
      name: "native.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      data: "cG5n",
    },
  ]);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      createElement(InboxCommentForm, {
        draftKey: "jira-native-drop",
        target: "Jira",
        replyTo: null,
        posting: false,
        error: null,
        onCancelReply: vi.fn(),
        onSubmit,
      }),
    ),
  );
  const zone = container.querySelector('[aria-label="Markdown formatting"]')!.parentElement!;
  zone.getBoundingClientRect = () => ({ left: 10, right: 100, top: 10, bottom: 100 }) as DOMRect;
  await act(async () => {
    nativeDrop.listener!({
      payload: { type: "drop", position: { x: 200, y: 200 }, paths: ["outside.png"] },
    });
  });
  expect(attachmentsFromPaths).not.toHaveBeenCalled();
  await act(async () => {
    nativeDrop.listener!({
      payload: { type: "drop", position: { x: 20, y: 20 }, paths: ["native.png"] },
    });
  });
  expect(attachmentsFromPaths).toHaveBeenCalledWith(["native.png"]);
  expect(container.querySelector('img[alt="native.png"]')).not.toBeNull();
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(onSubmit).toHaveBeenCalledWith("", [expect.objectContaining({ name: "native.png" })]);
  act(() => root.unmount());
  vi.mocked(isTauri).mockReturnValue(false);
});
