import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { completedResponseSpeed, formatResponseSpeed, responseSpeedFill } from "./responseSpeed";

const completed: Block = {
  id: "turn",
  role: "user",
  text: "hello",
  durationMs: 4000,
  turnMetrics: { outputTokens: 200 },
};

describe("completedResponseSpeed", () => {
  it("uses provider output and the full completed duration, ignoring tool text", () => {
    expect(
      completedResponseSpeed([completed, { id: "tool", role: "tool", text: "a".repeat(5000) }]),
    ).toEqual({ tps: 50, outputTokens: 200, durationMs: 4000 });
  });
  it("keeps the previous completed reading during an unfinished response", () => {
    expect(
      completedResponseSpeed([
        completed,
        { id: "new", role: "user", text: "next", turnMetrics: { outputTokens: 500 } },
      ])?.tps,
    ).toBe(50);
  });
  it("does not invent a speed or reuse old accounting when the latest completion lacks metrics", () => {
    expect(
      completedResponseSpeed([
        completed,
        { id: "new", role: "user", text: "next", durationMs: 2000 },
      ]),
    ).toBeNull();
    expect(completedResponseSpeed([{ ...completed, durationMs: 0 }])).toBeNull();
    expect(
      completedResponseSpeed([{ ...completed, turnMetrics: { outputTokens: Number.NaN } }]),
    ).toBeNull();
    expect(
      completedResponseSpeed([{ ...completed, turnMetrics: { outputTokens: -1 } }]),
    ).toBeNull();
    expect(completedResponseSpeed([])).toBeNull();
  });
  it("retains an explicitly reported zero and fits large values inside the ring", () => {
    expect(completedResponseSpeed([{ ...completed, turnMetrics: { outputTokens: 0 } }])?.tps).toBe(
      0,
    );
    expect(formatResponseSpeed(42.55)).toBe("42.5");
    expect(formatResponseSpeed(1300)).toBe("1.3k");
  });
});

describe("responseSpeedFill", () => {
  it.each([
    [undefined, 0],
    [null, 0],
    [0, 0],
    [-1, 0],
    [Number.NaN, 0],
    [Infinity, 0],
    [0.1, 0.25],
    [9.99, 0.25],
    [10, 0.5],
    [29.99, 0.5],
    [30, 0.75],
    [59.99, 0.75],
    [60, 1],
    [200, 1],
  ])("maps %s TPS to a fill of %s", (tps, fill) => {
    expect(responseSpeedFill(tps)).toBe(fill);
  });
});
