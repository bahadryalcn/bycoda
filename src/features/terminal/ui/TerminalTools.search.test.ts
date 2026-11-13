// @vitest-environment happy-dom
import { act, createElement, type KeyboardEventHandler } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { expect, it, vi } from "vitest";
import { TerminalTools } from "./TerminalTools";

const search = vi.hoisted(() => ({ next: vi.fn(() => true) }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = search.next;
    onDidChangeResults() {
      return { dispose() {} };
    }
    clearDecorations() {}
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
        }),
      ),
    );
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

it("coalesces output bursts, refreshes resizing immediately and cancels closed searches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let parsed!: () => void;
  let resize!: () => void;
  const host = document.createElement("div");
  const root = createRoot(host);
  const terminal = {
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
    onWriteParsed: (listener: () => void) => {
      parsed = listener;
      return { dispose() {} };
    },
    onResize: (listener: () => void) => {
      resize = listener;
      return { dispose() {} };
    },
    loadAddon() {},
    clearSelection() {},
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
    await act(async () => {
      for (let n = 0; n < 100; n++) parsed();
    });
    expect(search.next).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(search.next).toHaveBeenCalledTimes(1);
    await act(async () => {
      parsed();
      resize();
    });
    expect(search.next).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(search.next).toHaveBeenCalledTimes(2);
    await act(async () => {
      parsed();
      render(null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(search.next).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
