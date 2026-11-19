// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const renders = vi.hoisted(() => ({ picker: 0, mentionParses: 0 }));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../files/public/fileMentions", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../files/public/fileMentions")>();
  return {
    ...original,
    mentionTokenAt: (...args: Parameters<typeof original.mentionTokenAt>) => {
      renders.mentionParses += 1;
      return original.mentionTokenAt(...args);
    },
  };
});
vi.mock("./ModelPicker", () => ({
  ModelPicker: () => {
    renders.picker += 1;
    return null;
  },
}));

import { Composer } from "./Composer";

it("typing re-renders the toolbar a bounded number of times and keeps saving the draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDraftChange = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: false,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          executionCwd: "~",
          hideTopBar: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
          onDraftChange,
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    const before = renders.picker;
    const text = "hello world, this is a typing test";
    for (let i = 1; i <= text.length; i += 1) {
      await act(async () => {
        setter.call(textarea, text.slice(0, i));
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const perKey = (renders.picker - before) / text.length;
    console.log(`ModelPicker renders per keystroke: ${perKey}`);
    expect(perKey).toBeLessThanOrEqual(0.1);
    expect(onDraftChange).toHaveBeenLastCalledWith(text);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});

it("parses the slash, dollar and mention tokens once per typed character, not again on select and keyup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDraftChange = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: false,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          executionCwd: "~",
          hideTopBar: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
          onDraftChange,
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    const text = "hello @wor";
    const before = renders.mentionParses;
    for (let i = 1; i <= text.length; i += 1) {
      await act(async () => {
        setter.call(textarea, text.slice(0, i));
        textarea.setSelectionRange(i, i);
        // A real keystroke fires all three, with the same text and caret.
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("select", { bubbles: true }));
        textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
      });
    }
    expect(renders.mentionParses - before).toBe(text.length);

    // Moving the caret without typing is still parsed, so the menu follows it.
    const afterTyping = renders.mentionParses;
    await act(async () => {
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowLeft" }));
    });
    expect(renders.mentionParses - afterTyping).toBe(1);
    expect(onDraftChange).toHaveBeenLastCalledWith(text);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});
