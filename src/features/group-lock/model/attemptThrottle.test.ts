import { describe, expect, it } from "vitest";
import {
  blockedForMs,
  cooldownMs,
  formatCooldown,
  NO_ATTEMPTS,
  parseAttemptState,
  recordFailure,
} from "./attemptThrottle";

describe("attempt throttle", () => {
  it("allows four wrong passwords, then cools down on the fifth", () => {
    let state = NO_ATTEMPTS;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      state = recordFailure(state, 1000);
      expect(blockedForMs(state, 1000)).toBe(0);
    }
    state = recordFailure(state, 1000);
    expect(state.failures).toBe(5);
    expect(blockedForMs(state, 1000)).toBe(30_000);
  });

  it("doubles the cool-down for each further failure and caps it", () => {
    expect(cooldownMs(5)).toBe(30_000);
    expect(cooldownMs(6)).toBe(60_000);
    expect(cooldownMs(7)).toBe(120_000);
    expect(cooldownMs(20)).toBe(15 * 60_000);
    expect(cooldownMs(1000)).toBe(15 * 60_000);
  });

  it("stops blocking once the time has passed", () => {
    const state = { failures: 5, blockedUntil: 31_000 };
    expect(blockedForMs(state, 1000)).toBe(30_000);
    expect(blockedForMs(state, 31_000)).toBe(0);
    expect(blockedForMs(state, 99_000)).toBe(0);
  });

  it("reads stored state defensively", () => {
    expect(parseAttemptState("nope")).toEqual(NO_ATTEMPTS);
    expect(parseAttemptState({ failures: -3, blockedUntil: "x" })).toEqual(NO_ATTEMPTS);
    expect(parseAttemptState({ failures: 6, blockedUntil: 5 })).toEqual({
      failures: 6,
      blockedUntil: 5,
    });
  });

  it("words the wait for people", () => {
    expect(formatCooldown(1)).toBe("1 second");
    expect(formatCooldown(30_000)).toBe("30 seconds");
    expect(formatCooldown(61_000)).toBe("2 minutes");
  });
});
