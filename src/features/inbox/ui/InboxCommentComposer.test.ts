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
vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", { "data-comment-preview": "" }, text),
}));
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

it("switches source, split and preview without losing the draft or submitting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSubmit = vi.fn();
  await act(async () =>
    root.render(
      createElement(InboxCommentForm, {
        draftKey: "jira-preview-modes",
        target: "Jira",
        replyTo: null,
        posting: false,
        error: null,
        onCancelReply: vi.fn(),
        onSubmit,
      }),
    ),
  );
  const editor = container.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      editor,
      "**preview draft**",
    );
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const select = async (label: string) => {
    const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (tab) => tab.textContent === label,
    )!;
    expect(tab).toBeDefined();
    await act(async () => tab.click());
    expect(tab.getAttribute("aria-selected")).toBe("true");
  };
  expect(container.querySelector("[data-comment-preview]")?.textContent).toBe("**preview draft**");
  await select("Preview");
  expect(editor.closest("[hidden]")).not.toBeNull();
  expect(container.querySelector("[data-comment-preview]")?.textContent).toBe("**preview draft**");
  await select("Source");
  expect(editor.closest("[hidden]")).toBeNull();
  expect(container.querySelector("[data-comment-preview]")).toBeNull();
  await select("Split");
  expect(editor.value).toBe("**preview draft**");
  expect(editor.closest("[hidden]")).toBeNull();
  expect(container.querySelector("[data-comment-preview]")?.textContent).toBe(editor.value);
  expect(onSubmit).not.toHaveBeenCalled();
  act(() => root.unmount());
  container.remove();
});

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
  const zone = container.querySelector<HTMLElement>("[data-inbox-comment-editor]")!;
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

it.each(["GitHub", "GitLab", "Azure DevOps", "Linear"])(
  "keeps %s drafts and submission contract across preview modes and remount",
  async (target) => {
    const container = document.createElement("div");
    document.body.append(container);
    let root = createRoot(container);
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const props = {
      draftKey: `parity-${target}`,
      target,
      replyTo: null,
      posting: false,
      error: null,
      onCancelReply: vi.fn(),
      onSubmit,
    };
    await act(async () => root.render(createElement(InboxCommentForm, props)));
    const field = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        field,
        "**draft**",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const tab = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
        (node) => node.textContent === label,
      )!;
    await act(async () => tab("Preview").click());
    expect(field.closest("[hidden]")).not.toBeNull();
    expect(container.querySelector("[data-comment-preview]")?.textContent).toBe("**draft**");
    await act(async () => tab("Source").click());
    expect(field.closest("[hidden]")).toBeNull();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onSubmit).toHaveBeenCalledWith("**draft**");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(createElement(InboxCommentForm, { ...props, posting: true })),
    );
    expect(container.querySelector("textarea")!.value).toBe("**draft**");
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(InboxCommentForm, props)));
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onSubmit).toHaveBeenLastCalledWith("**draft**");
    expect(container.querySelector("textarea")!.value).toBe("");
    await act(async () => root.unmount());
    container.remove();
  },
);

it("isolates comment and reply drafts when switching targets", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const props = {
    target: "Linear",
    replyTo: null,
    posting: false,
    error: null,
    onCancelReply: vi.fn(),
    onSubmit: vi.fn(),
  };
  const render = async (draftKey: string) =>
    act(async () => root.render(createElement(InboxCommentForm, { ...props, draftKey })));
  const write = (value: string) =>
    act(() => {
      const field = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        field,
        value,
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await render("isolation-item-comment");
  write("comment draft");
  await render("isolation-item-reply-1");
  expect(container.querySelector("textarea")!.value).toBe("");
  write("reply draft");
  await render("isolation-item-comment");
  expect(container.querySelector("textarea")!.value).toBe("comment draft");
  await render("isolation-item-reply-1");
  expect(container.querySelector("textarea")!.value).toBe("reply draft");
  await act(async () => root.unmount());
});
