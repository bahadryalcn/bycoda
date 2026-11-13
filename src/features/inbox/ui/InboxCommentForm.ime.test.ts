// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxCommentForm } from "./InboxComments";
import { JiraCommentEditor } from "./JiraCommentEditor";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("../../notes/public/NoteMarkdownEditor", () => ({
  runMarkdownCommand: vi.fn(),
  NoteMarkdownEditor: ({ value, label }: { value: string; label: string }) =>
    createElement("textarea", { value, "aria-label": label, readOnly: true }),
}));
it.each([
  { isComposing: true, keyCode: 13 },
  { isComposing: false, keyCode: 229 },
])("does not publish a Jira editor draft during IME Enter: %j", async (ime) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSubmit = vi.fn(async () => undefined);
  try {
    await act(async () =>
      root.render(
        createElement(JiraCommentEditor, {
          value: "未送信 Draft",
          onChange: vi.fn(),
          images: [],
          onImages: vi.fn(),
          disabled: false,
          draftIdentity: `jira-ime-${ime.keyCode}`,
          onSubmit,
        }),
      ),
    );
    const field = container.querySelector("textarea")!;
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      isComposing: ime.isComposing,
    });
    Object.defineProperty(event, "keyCode", { value: ime.keyCode });
    await act(async () => {
      field.dispatchEvent(event);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field.value).toBe("未送信 Draft");
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    resetRetainedState();
  }
});
it.each([
  { isComposing: true, keyCode: 13 },
  { isComposing: false, keyCode: 229 },
])("does not publish a comment while IME owns Enter: %j", async (ime) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSubmit = vi.fn(async () => undefined);
  try {
    await act(async () =>
      root.render(
        createElement(InboxCommentForm, {
          replyTo: null,
          posting: false,
          error: null,
          onCancelReply: vi.fn(),
          onSubmit,
          draftKey: `ime-${ime.keyCode}`,
          target: "GitHub",
        }),
      ),
    );
    const field = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        field,
        "Draft 日本語",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        isComposing: ime.isComposing,
      });
      Object.defineProperty(event, "keyCode", { value: ime.keyCode });
      field.dispatchEvent(event);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field.value).toBe("Draft 日本語");
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onSubmit).toHaveBeenCalledWith("Draft 日本語");
  } finally {
    act(() => root.unmount());
    container.remove();
    resetRetainedState();
  }
});
