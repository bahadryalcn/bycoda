// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const renders = vi.hoisted(() => ({ picker: 0 }));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
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
