import { describe, expect, it } from "vitest";
import { newSession, type Session } from "./session";
import {
  formatUsageLimitReset,
  usageLimitAfterTargetChange,
  USAGE_LIMIT_RESUME_GRACE_MS,
  usageLimitResetDelay,
  usageLimitResumeDue,
} from "./usageLimit";

function limited(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("codex", "/tmp/project"),
    usageLimit: { resetsAt: 10_000, resumeAtReset: true },
    ...patch,
  };
}

it.each([{ model: "codex:other" }, { providerAccountId: "work" }, { harness: "claude" as const }])(
  "offers manual continuation when the confirmed target changes to %j",
  (target) => {
    const before = limited();
    const next = { ...before, ...target };
    const recovery = usageLimitAfterTargetChange(before, next);
    expect(recovery?.recoveryFrom).toBeDefined();
    expect(usageLimitResumeDue({ ...next, usageLimit: recovery }, 100_000)).toBe(false);
    expect(usageLimitAfterTargetChange({ ...next, usageLimit: recovery }, before)).toEqual(
      before.usageLimit,
    );
    expect(usageLimitAfterTargetChange(before, before)).toBe(before.usageLimit);
  },
);

describe("usageLimitResumeDue", () => {
  it("waits for the reset plus a grace period", () => {
    expect(usageLimitResumeDue(limited(), 10_000)).toBe(false);
    expect(usageLimitResumeDue(limited(), 10_000 + USAGE_LIMIT_RESUME_GRACE_MS)).toBe(true);
  });

  it("only resumes idle sessions the user armed", () => {
    const later = 10_000 + USAGE_LIMIT_RESUME_GRACE_MS;
    expect(usageLimitResumeDue(limited({ busy: true }), later)).toBe(false);
    expect(usageLimitResumeDue(limited({ usageLimit: { resetsAt: 10_000 } }), later)).toBe(false);
    expect(usageLimitResumeDue(limited({ usageLimit: { resumeAtReset: true } }), later)).toBe(
      false,
    );
  });
});

describe("usageLimitResetDelay", () => {
  // Regression for #464: the flip to "Limit has reset" must be scheduled at resetsAt,
  // not left to the minute clock (which can trail the reset by up to a minute).
  it("schedules the flip exactly at the reset", () => {
    expect(usageLimitResetDelay(10_000, 4_000)).toBe(6_000);
  });

  it("is due immediately once the reset has passed", () => {
    expect(usageLimitResetDelay(10_000, 10_000)).toBe(0);
    expect(usageLimitResetDelay(10_000, 25_000)).toBe(0);
  });

  it("leaves a reset beyond one timer to the minute clock", () => {
    const maxTimer = 2_147_483_647;
    expect(usageLimitResetDelay(maxTimer, 0)).toBe(maxTimer);
    expect(usageLimitResetDelay(maxTimer + 1, 0)).toBeUndefined();
  });
});

describe("formatUsageLimitReset", () => {
  it("shows the time and what is left", () => {
    const now = new Date(2026, 8, 25, 22, 34).getTime();
    const today = new Date(2026, 8, 25, 23, 50).getTime();
    expect(formatUsageLimitReset(today, now)).toMatch(/ · in 1h 16m$/);
    const tomorrow = new Date(2026, 8, 26, 3, 16).getTime();
    expect(formatUsageLimitReset(tomorrow, now)).toMatch(/26.* · in 4h 42m$/);
  });
});
