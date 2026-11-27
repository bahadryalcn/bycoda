// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { firstTurnBelow, useTranscriptFollow, type TranscriptFollow } from "./useTranscriptFollow";
import { TranscriptRetentionContext, type TranscriptUiState } from "./TranscriptPool";
import { TranscriptVirtualization } from "./transcriptVirtualization";

function turnsWithBottoms(bottoms: number[]) {
  return bottoms.map(
    (bottom) =>
      ({
        getBoundingClientRect: () => ({ bottom, top: bottom - 20 }),
      }) as unknown as HTMLElement,
  );
}

function linearFirstTurnBelow(nodes: HTMLElement[], top: number) {
  return nodes.find((node) => node.getBoundingClientRect().bottom > top);
}

describe("firstTurnBelow", () => {
  it("matches the linear scan for every viewport offset", () => {
    const bottoms = [40, 90, 90, 150, 210, 330, 331, 500, 760];
    const nodes = turnsWithBottoms(bottoms);
    for (let top = -10; top <= 800; top += 5) {
      expect(firstTurnBelow(nodes, top)).toBe(linearFirstTurnBelow(nodes, top));
    }
  });

  it("returns undefined when every turn sits above the viewport", () => {
    const nodes = turnsWithBottoms([10, 20]);
    expect(firstTurnBelow(nodes, 20)).toBeUndefined();
    expect(firstTurnBelow([], 0)).toBeUndefined();
  });

  it("returns the first turn when the viewport starts above all turns", () => {
    const nodes = turnsWithBottoms([10, 20, 30]);
    expect(firstTurnBelow(nodes, -100)).toBe(nodes[0]);
  });
});

describe("rememberScroll", () => {
  it("reads the first visible virtual row only while a turn is virtualized", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const state: TranscriptUiState = {};
    const retention = {
      read: () => state,
      update: (patch: Partial<TranscriptUiState>) => Object.assign(state, patch),
      setDisclosure: () => {},
    };
    const virtualization = new TranscriptVirtualization();
    const firstVisibleRow = vi.spyOn(virtualization, "firstVisibleRow");
    let follow: TranscriptFollow | undefined;
    function Probe() {
      follow = useTranscriptFollow({
        visible: false,
        lastUserId: undefined,
        virtualization,
      });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const scroller = document.createElement("div");
    vi.spyOn(scroller, "clientHeight", "get").mockReturnValue(400);
    document.body.append(scroller);
    try {
      act(() =>
        root.render(
          createElement(
            TranscriptRetentionContext.Provider,
            { value: retention },
            createElement(Probe),
          ),
        ),
      );
      // The reader scrolled away from the end.
      follow!.stickToBottom.current = false;
      follow!.rememberScroll(scroller);
      expect(state.bottomFollow).toBe(false);
      expect(firstVisibleRow).not.toHaveBeenCalled();
      const turn = document.createElement("div");
      turn.dataset.transcriptVirtualizedTurn = "true";
      scroller.append(turn);
      follow!.rememberScroll(scroller);
      expect(firstVisibleRow).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      container.remove();
      scroller.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe("reader motion", () => {
  // Paints frames only when the test says so: Linux WebKit painted no frame for seconds
  // while a wheel's animated scroll was under way.
  function harness() {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    let follow: TranscriptFollow | undefined;
    let onJumpToBottomChange = () => {};
    function Probe() {
      follow = useTranscriptFollow({ visible: true, lastUserId: undefined, onJumpToBottomChange });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const scroller = document.createElement("div");
    let top = 762;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, scroller.scrollHeight - scroller.clientHeight));
      },
    });
    vi.spyOn(scroller, "clientHeight", "get").mockReturnValue(646);
    vi.spyOn(scroller, "scrollHeight", "get").mockReturnValue(1408);
    document.body.append(scroller);
    act(() => root.render(createElement(Probe)));
    act(() => follow!.setScroller(scroller as HTMLDivElement));
    return {
      follow: () => follow!,
      scroller,
      pending: () => frames.size,
      at: (ms: number) => {
        now = ms;
      },
      // One painted frame: the scroll event (when the offset moved) precedes frame callbacks.
      paint: (nextTop?: number) => {
        if (nextTop !== undefined && nextTop !== top) {
          top = nextTop;
          scroller.dispatchEvent(new Event("scroll"));
        }
        const due = frames;
        frames = new Map();
        for (const callback of due.values()) callback(now);
      },
      move: (nextTop: number) => {
        top = nextTop;
      },
      wheel: (init: WheelEventInit) => scroller.dispatchEvent(new WheelEvent("wheel", init)),
      rerender: () => {
        onJumpToBottomChange = () => {};
        act(() => root.render(createElement(Probe)));
      },
      dispose: () => {
        act(() => root.unmount());
        container.remove();
        scroller.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      },
    };
  }

  it("credits the CI wheel: one frame, nothing painted for seconds, then the top", () => {
    const h = harness();
    try {
      h.wheel({ deltaY: -2400 });
      h.paint(720);
      // Linux WebKit: the next frame came 4.3s later and landed on the top.
      h.at(1000 + 4300);
      h.move(0);
      // React's onScroll runs before the motion listener has seen this event.
      expect(h.follow().hasReaderInput()).toBe(true);
      h.paint(0);
      expect(h.follow().hasReaderInput()).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("credits a first frame that arrives seconds after the wheel", () => {
    const h = harness();
    try {
      h.wheel({ deltaY: -100 });
      h.at(1000 + 2900);
      h.paint(0);
      expect(h.follow().hasReaderInput()).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("ends after painted frames without movement, stops its frame loop and ignores later moves up", () => {
    const h = harness();
    try {
      h.wheel({ deltaY: -100 });
      h.paint(700);
      h.at(2500);
      for (let frame = 0; frame < 3; frame += 1) h.paint();
      expect(h.pending()).toBe(0);
      expect(h.follow().hasReaderInput()).toBe(false);
      // A later programmatic move up is not the reader's.
      h.paint(500);
      expect(h.follow().hasReaderInput()).toBe(false);
      expect(h.pending()).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("ends when the page is hidden and after the absolute cap", () => {
    const h = harness();
    const hidden = vi.spyOn(document, "hidden", "get");
    try {
      h.wheel({ deltaY: -100 });
      h.at(2500);
      hidden.mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(h.pending()).toBe(0);
      h.paint(300);
      expect(h.follow().hasReaderInput()).toBe(false);
      hidden.mockReturnValue(false);
      h.at(3000);
      h.wheel({ deltaY: -100 });
      h.at(3000 + 10_001);
      h.move(100);
      expect(h.follow().hasReaderInput()).toBe(false);
    } finally {
      hidden.mockRestore();
      h.dispose();
    }
  });

  it("never starts from downward or horizontal wheels, typing or a nested scroller", () => {
    const h = harness();
    try {
      h.wheel({ deltaY: 100 });
      h.wheel({ deltaX: -100 });
      const field = document.createElement("textarea");
      document.body.append(field);
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      field.remove();
      const inner = document.createElement("pre");
      Object.defineProperty(inner, "scrollHeight", { value: 900 });
      Object.defineProperty(inner, "clientHeight", { value: 100 });
      Object.defineProperty(inner, "scrollTop", { value: 400 });
      inner.style.overflowY = "auto";
      h.scroller.append(inner);
      inner.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
      expect(h.pending()).toBe(0);
      h.at(3000);
      h.paint(200);
      expect(h.follow().hasReaderInput()).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("ends when the offset moves down and survives a listener reinstall", () => {
    const h = harness();
    try {
      h.wheel({ deltaY: -100 });
      h.paint(600);
      h.rerender();
      h.at(4000);
      h.paint(100);
      expect(h.follow().hasReaderInput()).toBe(true);
      h.paint(400);
      expect(h.follow().hasReaderInput()).toBe(false);
    } finally {
      h.dispose();
    }
  });
});
