// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalCursorPopover } from "./TerminalCursorPopover";
import { TerminalGhostText } from "./TerminalGhostText";

const seen = vi.hoisted(() => ({ portals: 0, anchors: [] as DOMRect[] }));
vi.mock("../../../shared/ui/Portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => {
    seen.portals += 1;
    return children;
  },
}));
vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({ anchor }: { anchor: DOMRect }) => {
    seen.anchors.push(anchor);
    return createElement("div", { "data-popover": true });
  },
}));
vi.mock("../model/localTerminalCompletion", () => ({ localTerminalPrefix: () => "" }));

let root: Root;
let host: HTMLElement;
let screen: HTMLElement;
let cursorX: number;
let handlers: Record<"render" | "resize" | "scroll" | "selection", () => void>;
let terminal: Terminal;
let frames: (() => void)[];
let rectReads: number;

function runFrames() {
  const queued = frames;
  frames = [];
  queued.forEach((frame) => frame());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => frames.push(fn));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  seen.portals = 0;
  seen.anchors = [];
  rectReads = 0;
  cursorX = 4;
  host = document.createElement("div");
  const element = document.createElement("div");
  screen = document.createElement("div");
  screen.className = "xterm-screen";
  Object.defineProperty(screen, "clientWidth", { value: 800 });
  Object.defineProperty(screen, "clientHeight", { value: 400 });
  screen.getBoundingClientRect = () => {
    rectReads += 1;
    return new DOMRect(10, 20, 800, 400);
  };
  element.append(screen);
  document.body.append(host, element);
  root = createRoot(host);
  const disposable = { dispose() {} };
  const subscribe = (name: keyof typeof handlers) => (fn: () => void) => {
    handlers[name] = fn;
    return disposable;
  };
  handlers = { render() {}, resize() {}, scroll() {}, selection() {} };
  terminal = {
    element,
    cols: 80,
    rows: 20,
    options: { fontFamily: "mono", fontSize: 13 },
    hasSelection: () => false,
    onRender: subscribe("render"),
    onResize: subscribe("resize"),
    onScroll: subscribe("scroll"),
    onSelectionChange: subscribe("selection"),
    buffer: {
      active: {
        type: "normal",
        baseY: 0,
        viewportY: 0,
        cursorY: 0,
        get cursorX() {
          return cursorX;
        },
      },
    },
  } as unknown as Terminal;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  terminal.element?.remove();
  vi.unstubAllGlobals();
});

it("ghost text keeps its layout through a render burst with an unchanged cursor", async () => {
  await act(async () => root.render(createElement(TerminalGhostText, { terminal, suffix: "x" })));
  const initial = seen.portals;
  expect(initial).toBeGreaterThan(0);
  await act(async () => {
    for (let index = 0; index < 20; index += 1) handlers.render();
    runFrames();
  });
  expect(seen.portals).toBe(initial);
});

it("ghost text measures once per frame and reads the cursor at frame time", async () => {
  await act(async () => root.render(createElement(TerminalGhostText, { terminal, suffix: "x" })));
  await act(async () => {
    cursorX = 5;
    handlers.render();
    cursorX = 9;
    handlers.render();
    handlers.scroll();
  });
  expect(frames).toHaveLength(1);
  await act(async () => runFrames());
  const ghost = host.ownerDocument.querySelector<HTMLElement>("[aria-hidden]");
  expect(ghost?.style.insetInlineStart).toBe(`${9 * 10}px`);
});

it("ghost text drops a queued measurement on unmount", async () => {
  await act(async () => root.render(createElement(TerminalGhostText, { terminal, suffix: "x" })));
  const cancel = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancel);
  await act(async () => handlers.render());
  await act(async () => root.render(null));
  expect(cancel).toHaveBeenCalled();
});

it("cursor popover coalesces a render burst into one layout read and ignores unrelated scrolls", async () => {
  await act(async () =>
    root.render(createElement(TerminalCursorPopover, { terminal, onDismiss() {}, children: "x" })),
  );
  const initialReads = rectReads;
  await act(async () => {
    for (let index = 0; index < 20; index += 1) handlers.render();
    const unrelated = document.createElement("div");
    document.body.append(unrelated);
    unrelated.dispatchEvent(new Event("scroll"));
    unrelated.remove();
  });
  expect(frames).toHaveLength(1);
  await act(async () => runFrames());
  expect(rectReads).toBe(initialReads + 1);
  expect(seen.anchors.at(-1)?.x).toBe(10 + 4 * 10);
});

it("cursor popover re-measures when the screen's ancestor scrolls and follows the latest cursor", async () => {
  await act(async () =>
    root.render(createElement(TerminalCursorPopover, { terminal, onDismiss() {}, children: "x" })),
  );
  await act(async () => {
    cursorX = 12;
    document.dispatchEvent(new Event("scroll"));
  });
  expect(frames).toHaveLength(1);
  await act(async () => runFrames());
  expect(seen.anchors.at(-1)?.x).toBe(10 + 12 * 10);
});
