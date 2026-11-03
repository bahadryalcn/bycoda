// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";
import { extractChatCitations } from "../model/chatCitation";

const actionButton = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')).find(
    (button) => button.textContent?.includes(label),
  )!;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TranscriptSelectionMenu", () => {
  it("never retargets an open citation comment when a pane changes sessions", () => {
    const onAddToChat = vi.fn();
    const props = { onAddToChat, onDismiss: vi.fn() };
    const selection = {
      text: "Quoted words",
      responseText: "Quoted words",
      responseId: "reply-1",
      occurrence: 0,
      rect: new DOMRect(10, 20, 100, 20),
    };
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, { ...props, sessionId: "session-1", selection }),
      ),
    );
    act(() => actionButton("Add citation").click());
    expect(document.querySelector('[role="dialog"] textarea')).not.toBeNull();
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          ...props,
          sessionId: "session-2",
          selection: null,
        }),
      ),
    );
    expect(document.querySelector('[role="dialog"] textarea')).toBeNull();
    expect(onAddToChat).not.toHaveBeenCalled();
  });
  it("offers Reprompt only for an explicitly authorized user selection", async () => {
    const props = {
      selection: { text: "Message", rect: new DOMRect(10, 20, 100, 20) },
      onTranslate: vi.fn(),
      onDismiss: vi.fn(),
    };
    await act(async () => root.render(createElement(TranscriptSelectionMenu, props)));
    expect(actionButton("Reprompt")).toBeUndefined();
    await act(async () =>
      root.render(createElement(TranscriptSelectionMenu, { ...props, allowReprompt: true })),
    );
    expect(actionButton("Reprompt")).toBeDefined();
  });

  it("captures a source and optional comment without losing the quote when the native selection collapses", async () => {
    const onAddToChat = vi.fn();
    const props = { sessionId: "session-1", onAddToChat, onDismiss: vi.fn() };
    const selection = {
      text: "Same phrase",
      responseText: "Same phrase then Same phrase",
      responseId: "reply-1",
      occurrence: 1,
      rect: new DOMRect(10, 20, 100, 20),
    };
    act(() => root.render(createElement(TranscriptSelectionMenu, { ...props, selection })));
    act(() => actionButton("Add citation").click());
    act(() => root.render(createElement(TranscriptSelectionMenu, { ...props, selection: null })));
    const field = document.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "Make this compact");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const add = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ).find((button) => button.textContent === "Add to chat")!;
    await act(async () => add.click());
    expect(onAddToChat).toHaveBeenCalledOnce();
    const value = extractChatCitations(onAddToChat.mock.calls[0][0]).citations[0];
    expect(value).toMatchObject({
      sessionId: "session-1",
      blockId: "reply-1",
      text: "Same phrase",
      sourceText: "Same phrase then Same phrase",
      occurrence: 1,
      comment: "Make this compact",
    });
  });

  it("does not attach an old note failure to a reopened selection", async () => {
    let rejectSave!: (error: Error) => void;
    const onAddToNotes = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectSave = reject;
        }),
    );
    const props = { onAddToNotes, onDismiss: vi.fn() };
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          ...props,
          selection: { text: "Old selection", rect: new DOMRect(10, 20, 100, 20) },
        }),
      ),
    );
    await act(async () => actionButton("Add to notes").click());
    act(() => root.render(createElement(TranscriptSelectionMenu, { ...props, selection: null })));
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          ...props,
          selection: { text: "New selection", rect: new DOMRect(10, 20, 100, 20) },
        }),
      ),
    );
    await act(async () => rejectSave(new Error("Old failure")));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('button[aria-busy="true"]')).toBeNull();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("keeps one toolbar and clears the DOM selection only on Escape dismissal", () => {
    const onDismiss = vi.fn();
    const clearSelection = vi.spyOn(window.getSelection()!, "removeAllRanges");
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          selection: { text: "Preserve selected text", rect: new DOMRect(10, 20, 100, 20) },
          onAddToChat: vi.fn(),
          onDismiss,
        }),
      ),
    );
    expect(document.querySelectorAll('[role="toolbar"]')).toHaveLength(1);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(clearSelection).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onDismiss).toHaveBeenCalledTimes(3);
    expect(clearSelection).toHaveBeenCalledOnce();
    clearSelection.mockRestore();
  });

  it("keeps selected text available when saving a note fails", async () => {
    let rejectSave!: (reason: Error) => void;
    const onDismiss = vi.fn();
    const onAddToNotes = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          selection: { text: "Keep this", rect: new DOMRect(10, 20, 100, 20) },
          onAddToNotes,
          onDismiss,
        }),
      ),
    );
    const button = actionButton("Add to notes");
    await act(async () => button.click());
    expect(onDismiss).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => button.click());
    expect(onAddToNotes).toHaveBeenCalledOnce();
    await act(async () => rejectSave(new Error("Disk full")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(button.getAttribute("aria-disabled")).toBeNull();
    onAddToNotes.mockResolvedValue();
    await act(async () => button.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers the selected text to both chat and notes", () => {
    const onAddToChat = vi.fn();
    const onAddToNotes = vi.fn();
    const onDismiss = vi.fn();
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          selection: {
            text: "A useful link",
            rect: new DOMRect(10, 20, 100, 20),
          },
          onAddToChat,
          onAddToNotes,
          onDismiss,
        }),
      ),
    );

    const toolbar = document.querySelector('[role="toolbar"][aria-label="Selected text actions"]');
    expect(toolbar?.textContent).toContain("Add to chat");
    expect(toolbar?.textContent).toContain("Add to notes");

    const notes = Array.from(toolbar?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Add to notes"),
    );
    act(() => notes?.click());

    expect(onAddToNotes).toHaveBeenCalledWith("A useful link");
    expect(onAddToChat).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
