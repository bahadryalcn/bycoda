import { describe, expect, it } from "vitest";
import { hostLifetimeDeadline, remainingUntil } from "./hostLifetime";

describe("hostLifetimeDeadline", () => {
  it("counts the Host's lifetime from the moment the request was sent", () => {
    expect(hostLifetimeDeadline(30_000, 5_000)).toBe(35_000);
  });

  it("never runs past the Host's end when the reply arrives late", () => {
    // Host read its clock at t=10_000 (after receiving a request sent at t=5_000) and
    // granted 30 s, so it ends at 40_000 on its own clock. Replying later does not extend it.
    const deadline = hostLifetimeDeadline(30_000, 5_000);
    expect(deadline).toBeLessThanOrEqual(10_000 + 30_000);
  });

  it("ignores a skewed client wall clock because only monotonic readings are compared", () => {
    const sentAt = 1_000;
    const deadline = hostLifetimeDeadline(30_000, sentAt);
    expect(remainingUntil(deadline, sentAt)).toBe(30_000);
    expect(remainingUntil(deadline, deadline + 1)).toBe(0);
  });

  it("treats a negative lifetime as already ended", () => {
    expect(hostLifetimeDeadline(-5, 100)).toBe(100);
    expect(remainingUntil(100, 150)).toBe(0);
  });
});
