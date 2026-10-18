import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { completedResponseSpeed, formatResponseSpeed } from "./responseSpeed";

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
