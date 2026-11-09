import { describe, expect, it } from "vitest";
import { radioKeyTarget } from "./radioKeyTarget";

describe("radioKeyTarget", () => {
  it("wraps arrows and jumps with Home and End", () => {
    expect(radioKeyTarget("ArrowRight", 3, 4)).toBe(0);
    expect(radioKeyTarget("ArrowUp", 0, 4)).toBe(3);
    expect(radioKeyTarget("Home", 2, 4)).toBe(0);
    expect(radioKeyTarget("End", 1, 4)).toBe(3);
    expect(radioKeyTarget("a", 1, 4)).toBeNull();
  });
  it("skips disabled options", () => {
    const enabled = (i: number) => i !== 1 && i !== 3;
    expect(radioKeyTarget("ArrowRight", 0, 4, enabled)).toBe(2);
    expect(radioKeyTarget("ArrowLeft", 0, 4, enabled)).toBe(2);
    expect(radioKeyTarget("End", 0, 4, enabled)).toBe(2);
    expect(radioKeyTarget("ArrowRight", 0, 4, () => false)).toBeNull();
  });
});
