// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { firstTurnBelow } from "./useTranscriptFollow";
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
