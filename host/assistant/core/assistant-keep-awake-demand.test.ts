import { expect, it } from "vitest";
import { keepAwakeDemand, minutesUntilActiveHours } from "./assistant-keep-awake-demand";

const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m).getTime();
const base = {
  running: false,
  queuedJobs: false,
  canStartJobs: true,
  policy: { activeStart: 9, activeEnd: 17 },
};

it("holds for running work only by default", () => {
  expect(keepAwakeDemand({ ...base, now: at(3) })).toBe(false);
  expect(keepAwakeDemand({ ...base, running: true, now: at(3) })).toBe(true);
});

it("holds for queued jobs only within an hour of active hours opening", () => {
  const input = { ...base, queuedJobs: true };
  expect(minutesUntilActiveHours(base.policy, at(8, 30))).toBe(30);
  expect(keepAwakeDemand({ ...input, now: at(8, 30) })).toBe(true);
  expect(keepAwakeDemand({ ...input, now: at(8, 0) })).toBe(true);
  expect(keepAwakeDemand({ ...input, now: at(7, 59) })).toBe(false);
  expect(keepAwakeDemand({ ...input, now: at(12) })).toBe(false);
  expect(keepAwakeDemand({ ...input, canStartJobs: false, now: at(8, 30) })).toBe(false);
  expect(keepAwakeDemand({ ...base, now: at(8, 30) })).toBe(false);
});

it("handles overnight windows and always-open hours", () => {
  expect(minutesUntilActiveHours({ activeStart: 22, activeEnd: 6 }, at(21, 10))).toBe(50);
  expect(minutesUntilActiveHours({ activeStart: 0, activeEnd: 0 }, at(3))).toBe(0);
});

it("holds shortly before an unprepared briefing and releases afterwards", () => {
  const briefing = { enabled: true, time: "09:00", preparedToday: false };
  expect(keepAwakeDemand({ ...base, briefing, now: at(8, 50) })).toBe(true);
  expect(keepAwakeDemand({ ...base, briefing, now: at(8, 40) })).toBe(false);
  expect(keepAwakeDemand({ ...base, briefing, now: at(9, 5) })).toBe(false);
  expect(
    keepAwakeDemand({ ...base, briefing: { ...briefing, preparedToday: true }, now: at(8, 50) }),
  ).toBe(false);
  expect(
    keepAwakeDemand({ ...base, briefing: { ...briefing, enabled: false }, now: at(8, 50) }),
  ).toBe(false);
});
