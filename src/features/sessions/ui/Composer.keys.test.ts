// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  }),
}));

import { Composer } from "./Composer";
import { setHarnessModeLimits } from "../model/session";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setHarnessModeLimits("antigravity", undefined);
  vi.unstubAllGlobals();
});

async function renderComposer(
  props: {
    harness?: "claude" | "antigravity";
    busy?: boolean;
    backgroundOnly?: boolean;
    onStop?: () => void;
  },
  onSubmit: (...args: unknown[]) => boolean | void = () => true,
) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: props.harness ?? "claude",
        model: "m",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        sessionId: "s1",
        busy: props.busy,
        backgroundOnly: props.backgroundOnly,
        hideProjectPicker: true,
        hideBranchPicker: true,
        onFocus: () => {},
        onCwdChange: () => {},
        onModelChange: () => {},
        onRuntimeModeChange: () => {},
        onSubmit: onSubmit as never,
        onStop: props.onStop,
      }),
    ),
  );
  return container.querySelector("textarea")!;
}

async function type(textarea: HTMLTextAreaElement, text: string) {
  await act(async () => {
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(textarea: HTMLTextAreaElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    textarea.dispatchEvent(event);
  });
  return event;
}

describe("Claude Code stop keys", () => {
  it("stops the running turn on Escape", async () => {
    const onStop = vi.fn();
    const textarea = await renderComposer({ busy: true, onStop });
    const event = press(textarea, { key: "Escape", code: "Escape" });
    expect(event.defaultPrevented).toBe(true);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("stops on Ctrl+C only when nothing is selected", async () => {
    const onStop = vi.fn();
    const textarea = await renderComposer({ busy: true, onStop });
    await type(textarea, "draft");
    textarea.setSelectionRange(0, 5);
    press(textarea, { key: "c", code: "KeyC", ctrlKey: true });
    expect(onStop).not.toHaveBeenCalled();

    textarea.setSelectionRange(5, 5);
    press(textarea, { key: "c", code: "KeyC", ctrlKey: true });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone when idle", async () => {
    const onStop = vi.fn();
    const textarea = await renderComposer({ busy: false, onStop });
    press(textarea, { key: "Escape", code: "Escape" });
    expect(onStop).not.toHaveBeenCalled();
  });

  it("keeps Shift+Tab queueing while a turn runs", async () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn(() => true);
    const textarea = await renderComposer({ busy: true, onStop }, onSubmit);
    await type(textarea, "next");
    press(textarea, { key: "Tab", code: "Tab", shiftKey: true });
    await act(async () => {});
    expect(onSubmit).toHaveBeenCalledWith(
      "next",
      [],
      expect.objectContaining({ followUpBehavior: "queue" }),
    );
    expect(onStop).not.toHaveBeenCalled();
  });
});
