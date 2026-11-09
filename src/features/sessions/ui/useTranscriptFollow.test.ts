// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { firstTurnBelow } from "./useTranscriptFollow";

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
