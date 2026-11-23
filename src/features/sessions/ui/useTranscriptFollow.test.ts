// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { firstTurnBelow, useTranscriptFollow, type TranscriptFollow } from "./useTranscriptFollow";
import { TranscriptRetentionContext, type TranscriptUiState } from "./TranscriptPool";
import { TranscriptVirtualization } from "./transcriptVirtualization";
import { isStaleFollowReplay } from "./transcriptScroll";

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

describe("isStaleFollowReplay", () => {
  const base = {
    following: true,
    scrolledUp: true,
    held: false,
    now: 1000,
    inputUntil: 0,
    downUntil: 0,
    top: 2814,
    followedTops: [{ top: 4010, at: 990 }],
  };

  it("treats an offset a downward wheel crossed as a replay once at the end", () => {
    expect(isStaleFollowReplay({ ...base, downUntil: 1500 })).toBe(true);
  });

  it("leaves a jump up with no recent follow or downward gesture to the reader", () => {
    expect(isStaleFollowReplay(base)).toBe(false);
  });

  it("never overrides reader input", () => {
    expect(isStaleFollowReplay({ ...base, downUntil: 1500, held: true })).toBe(false);
    expect(isStaleFollowReplay({ ...base, downUntil: 1500, inputUntil: 1200 })).toBe(false);
    expect(isStaleFollowReplay({ ...base, downUntil: 1500, following: false })).toBe(false);
    expect(isStaleFollowReplay({ ...base, downUntil: 500 })).toBe(false);
  });

  it("still recognises a replay of an offset it followed through", () => {
    expect(
      isStaleFollowReplay({
        ...base,
        top: 4000,
        followedTops: [{ top: 3990, at: 900 }],
      }),
    ).toBe(true);
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

describe("reader input", () => {
  it("stays the reader's while one wheel's animated scroll keeps moving up past the input window", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let follow: TranscriptFollow | undefined;
    function Probe() {
      follow = useTranscriptFollow({ visible: true, lastUserId: undefined });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const scroller = document.createElement("div");
    let top = 2000;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    vi.spyOn(scroller, "clientHeight", "get").mockReturnValue(400);
    vi.spyOn(scroller, "scrollHeight", "get").mockReturnValue(2400);
    document.body.append(scroller);
    const scrollTo = (value: number, at: number) => {
      now = at;
      top = value;
      scroller.dispatchEvent(new Event("scroll"));
    };
    try {
      act(() => root.render(createElement(Probe)));
      act(() => follow!.setScroller(scroller as HTMLDivElement));
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -2400 }));
      // WebKit animates the long delta: it is still far from the top after the input window.
      for (let step = 1; step <= 20; step += 1) scrollTo(2000 - step * 100, 1000 + step * 100);
      expect(top).toBe(0);
      expect(now).toBeGreaterThan(1000 + 1000);
      expect(follow!.hasReaderInput()).toBe(true);
      // Once the motion stops, the window is no longer renewed and runs out.
      scrollTo(0, 3100);
      now = 4200;
      expect(follow!.hasReaderInput()).toBe(false);
      // A later upward scroll with no new input (a programmatic move) is not the reader's.
      scrollTo(600, 4300);
      scrollTo(500, 4400);
      expect(follow!.hasReaderInput()).toBe(false);
    } finally {
      act(() => root.unmount());
      container.remove();
      scroller.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
