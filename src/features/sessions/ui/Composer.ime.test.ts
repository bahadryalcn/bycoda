// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Composer } from "./Composer";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

it("keeps the textarea's text node when a parent re-renders with the latest draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (initialDraft: string) =>
    root.render(
      createElement(Composer, {
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "~",
        initialDraft,
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: vi.fn(),
      }),
    );
  try {
    await act(async () => render("你"));
    const textarea = container.querySelector("textarea")!;
    expect(textarea.defaultValue).toBe("你");
    // A remote session's poll re-renders the pane with the draft typed so
    // far. Rewriting the text node makes WebKit commit the IME composition.
    textarea.value = "你好";
    await act(async () => render("你好"));
    expect(textarea.defaultValue).toBe("你");
    expect(textarea.value).toBe("你好");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});

it("projects an accepted external draft into Send and refuses to replace an IME composition", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (initialDraft: string | undefined) =>
    root.render(
      createElement(Composer, {
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "~",
        initialDraft,
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: vi.fn(),
      }),
    );
  const send = () => container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
  try {
    await act(async () => render(undefined));
    const textarea = container.querySelector("textarea")!;
    expect(send().disabled).toBe(true);
    // The parent hands the mounted, empty input a nonempty draft.
    await act(async () => render("/plan "));
    expect(textarea.value).toBe("/plan ");
    expect(send().disabled).toBe(false);

    // A different external draft arriving mid-composition leaves the input alone.
    await act(async () => {
      textarea.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      textarea.value = "/plan 你";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => render("something else"));
    expect(textarea.value).toBe("/plan 你");
    await act(async () => {
      textarea.dispatchEvent(new Event("compositionend", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(textarea.value).toBe("/plan 你");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});
