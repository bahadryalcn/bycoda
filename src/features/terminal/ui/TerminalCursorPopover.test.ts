// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";

const anchors = vi.hoisted(() => [] as { anchor: DOMRect; solid?: boolean }[]);
vi.mock("../../../shared/ui/Popover", () => ({
  Popover: (props: { anchor: DOMRect; solid?: boolean }) => {
    anchors.push(props);
    return null;
  },
}));
import { TerminalCursorPopover } from "./TerminalCursorPopover";

afterEach(() => {
  anchors.length = 0;
  vi.unstubAllGlobals();
});

it("anchors at the start of the typed command so typing does not move the popover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const element = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  screen.getBoundingClientRect = () => new DOMRect(0, 0, 800, 240);
  element.append(screen);
  let line = "$ git s";
  let render = () => {};
  const disposable = { dispose() {} };
  const terminal = {
    element,
    cols: 80,
    rows: 24,
    hasSelection: () => false,
    onRender: (fn: () => void) => {
      render = fn;
      return disposable;
    },
    onResize: () => disposable,
    onScroll: () => disposable,
    buffer: {
      active: {
        type: "normal",
        baseY: 0,
        viewportY: 0,
        cursorY: 0,
        get cursorX() {
          return line.length;
        },
        getLine: () => ({
          isWrapped: false,
          translateToString: (trim: boolean, start = 0, end = line.length) => {
            const value = line.slice(start, end);
            return trim ? value.trimEnd() : value;
          },
        }),
      },
    },
  } as unknown as Terminal;
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement(TerminalCursorPopover, { terminal, onDismiss: () => {} }, "x")),
    );
    const first = anchors.at(-1)!;
    expect(first.solid).toBe(true);
    expect(first.anchor.x).toBe(20);
    line = "$ git sta";
    await act(async () => render());
    expect(anchors.at(-1)!.anchor).toBe(first.anchor);
  } finally {
    await act(async () => root.unmount());
  }
});
