// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";

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
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[role="toolbar"] button')!.click(),
    );
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
    const button = document.querySelector<HTMLButtonElement>('[role="toolbar"] button')!;
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
