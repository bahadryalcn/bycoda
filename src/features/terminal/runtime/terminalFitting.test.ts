// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { beginResizeGesture } from "../../../shared/lib/resizeGesture";

const layout = vi.hoisted(() => ({ fit: vi.fn() }));
vi.mock("../model/terminalLayout", () => ({
  applyTerminalChrome: vi.fn(),
  resetGridStretch: vi.fn(),
  fitTerminal: layout.fit,
}));

import { createTerminalFitting } from "./terminalFitting";

let observe: () => void = () => {};
let frames: Array<() => void> = [];

function flushFrame() {
  const run = frames;
  frames = [];
  for (const callback of run) callback();
}

function setup() {
  const term = {
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
    onRender: () => ({ dispose() {} }),
  } as unknown as Terminal;
  const outer = document.createElement("div");
  const resize = vi.fn(async () => {});
  const fitting = createTerminalFitting({
    term,
    outer,
    host: document.createElement("div"),
    lineHeight: () => 1,
    resize,
    isSpawned: () => true,
    onEnterAlternateScreen: () => {},
  });
  fitting.attach();
  flushFrame(); // the first fit
  return { fitting, resize };
}

beforeEach(() => {
  frames = [];
  layout.fit.mockReset();
  layout.fit.mockReturnValue({ cols: 80, rows: 24 });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observe = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("terminal fitting during a live resize", () => {
  it("fits on the next frame when the size changes outside a gesture", () => {
    const { resize } = setup();
    resize.mockClear();
    layout.fit.mockReturnValue({ cols: 100, rows: 30 });
    observe();
    flushFrame();
    expect(resize).toHaveBeenCalledExactlyOnceWith(100, 30);
  });

  it("follows the box a few times a second while a gesture is live, then fits the settled size", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { resize } = setup();
    resize.mockClear();
    layout.fit.mockClear();
    const end = beginResizeGesture();
    for (let cols = 81; cols < 90; cols++) {
      layout.fit.mockReturnValue({ cols, rows: 24 });
      observe();
      flushFrame();
    }
    // Nine frames, no fit yet: the grid does not reflow on every frame.
    expect(layout.fit).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(layout.fit).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledExactlyOnceWith(89, 24);

    layout.fit.mockReturnValue({ cols: 95, rows: 24 });
    observe();
    flushFrame();
    end();
    expect(resize).toHaveBeenLastCalledWith(95, 24);
    expect(resize).toHaveBeenCalledTimes(2);

    // The pending live fit was dropped with the gesture.
    vi.advanceTimersByTime(500);
    expect(layout.fit).toHaveBeenCalledTimes(2);
  });

  it("does not fit after the gesture ends once the terminal is disposed", () => {
    const { fitting, resize } = setup();
    resize.mockClear();
    layout.fit.mockClear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const end = beginResizeGesture();
    observe();
    flushFrame();
    fitting.dispose();
    end();
    vi.advanceTimersByTime(500);
    expect(layout.fit).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });
});
