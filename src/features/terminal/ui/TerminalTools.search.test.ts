// @vitest-environment happy-dom
import { act, createElement } from "react";
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
  SearchInput: ({ onChange, value }: { onChange: (event: unknown) => void; value: string }) =>
    createElement("input", { value, onInput: onChange, readOnly: true }),
}));

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
