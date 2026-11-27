// @vitest-environment happy-dom
import { act, createElement, type KeyboardEventHandler } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { expect, it, vi } from "vitest";
import { TerminalTools } from "./TerminalTools";

const search = vi.hoisted(() => ({
  next: vi.fn(() => true),
  previous: vi.fn(() => true),
  clear: vi.fn(),
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = search.next;
    findPrevious = search.previous;
    clearDecorations = search.clear;
    onDidChangeResults() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("../../../shared/ui/SearchInput", () => ({
  SearchInput: ({
    onChange,
    value,
    onKeyDown,
  }: {
    onChange: (event: unknown) => void;
    value: string;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  }) => createElement("input", { value, onInput: onChange, onKeyDown, readOnly: true }),
}));

it("does not navigate or dismiss Find on WebKit composition confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const toolbarTarget = document.createElement("div");
  const root = createRoot(host);
  const changeMode = vi.fn();
  const disposable = { dispose() {} };
  const terminal = {
    buffer: { active: { type: "normal" }, onBufferChange: () => disposable },
    onWriteParsed: () => disposable,
    onResize: () => disposable,
    loadAddon() {},
    clearSelection() {},
    focus: vi.fn(),
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal,
          mode: "search",
          ready: true,
          onModeChange: changeMode,
          toolbarTarget,
        }),
      ),
    );
    expect(toolbarTarget.querySelector('button[aria-label="Find in terminal"]')).not.toBeNull();
    expect(
      toolbarTarget.querySelector('button[aria-label="Terminal pane actions"]'),
    ).not.toBeNull();
    expect(host.querySelector('button[aria-label="Find in terminal"]')).toBeNull();
    const input = host.querySelector("input")!;
    await act(async () => {
      input.value = "needle";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    search.next.mockClear();
    for (const key of ["Enter", "Escape"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => input.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(search.next).not.toHaveBeenCalled();
    expect(changeMode).not.toHaveBeenCalled();
    expect(terminal.focus).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps the viewport the user chose while output streams, and follows output at the bottom", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let parsed!: () => void;
  const buffer = { type: "normal", viewportY: 10, baseY: 100 };
  const scrollToLine = vi.fn();
  const scrollToBottom = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);
  const terminal = {
    buffer: { active: buffer, onBufferChange: () => ({ dispose() {} }) },
    onWriteParsed: (listener: () => void) => {
      parsed = listener;
      return { dispose() {} };
    },
    onResize: () => ({ dispose() {} }),
    loadAddon() {},
    hasSelection: () => true,
    clearSelection() {},
    scrollToLine,
    scrollToBottom,
    focus() {},
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal,
          mode: "search",
          ready: true,
          onModeChange() {},
        }),
      ),
    );
    await act(async () => {
      const input = host.querySelector("input")!;
      input.value = "needle";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    search.next.mockClear();
    search.previous.mockClear();

    // The addon scrolls a match outside the viewport into view; output must undo that.
    search.previous.mockImplementationOnce(() => {
      buffer.viewportY = 60;
      return true;
    });
    await act(async () => {
      parsed();
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(search.next).not.toHaveBeenCalled();
    expect(search.previous).toHaveBeenCalledTimes(1);
    expect(scrollToLine).toHaveBeenCalledWith(10);
    expect(scrollToBottom).not.toHaveBeenCalled();

    // A user following output stays at the bottom.
    buffer.viewportY = 100;
    search.previous.mockImplementationOnce(() => {
      buffer.viewportY = 60;
      return true;
    });
    await act(async () => {
      parsed();
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(search.next).not.toHaveBeenCalled();
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("coalesces output bursts, refreshes resizing immediately and cancels closed searches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let parsed!: () => void;
  let resize!: () => void;
  const host = document.createElement("div");
  const root = createRoot(host);
  const terminal = {
    buffer: {
      active: { type: "normal", viewportY: 0, baseY: 0 },
      onBufferChange: () => ({ dispose() {} }),
    },
    onWriteParsed: (listener: () => void) => {
      parsed = listener;
      return { dispose() {} };
    },
    onResize: (listener: () => void) => {
      resize = listener;
      return { dispose() {} };
    },
    loadAddon() {},
    hasSelection: () => true,
    clearSelection() {},
    scrollToBottom() {},
    scrollToLine() {},
    focus() {},
  } as unknown as Terminal;
  const render = (mode: "search" | null) =>
    root.render(
      createElement(TerminalTools, {
        terminal,
        mode,
        ready: mode === "search",
        onModeChange() {},
      }),
    );
  try {
    await act(async () => render("search"));
    await act(async () => {
      const input = host.querySelector("input")!;
      input.value = "needle";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    search.next.mockClear();
    search.previous.mockClear();
    await act(async () => {
      for (let n = 0; n < 100; n++) parsed();
    });
    expect(search.previous).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(749);
    });
    expect(search.previous).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(search.previous).toHaveBeenCalledTimes(1);
    expect(search.next).not.toHaveBeenCalled();
    await act(async () => {
      parsed();
      resize();
    });
    expect(search.next).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(search.previous).toHaveBeenCalledTimes(1);
    await act(async () => {
      parsed();
      render(null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(search.previous).toHaveBeenCalledTimes(1);
    expect(search.next).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
