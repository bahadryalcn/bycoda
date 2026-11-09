import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY,
  autonomyLevel,
  nextWorkingStart,
  withinWorkingHours,
  type AutonomyAction,
  type AutonomyPolicy,
} from "./autonomy";

const ACTIONS: AutonomyAction[] = [
  "publish",
  "reply",
  "comment",
  "message",
  "email",
  "outreach",
  "audience",
  "contacts",
];

function policy(patch: Partial<AutonomyPolicy> = {}): AutonomyPolicy {
  return {
    accountId: "account-1",
    version: 1,
    levels: { ...DEFAULT_AUTONOMY.levels },
    limits: { ...DEFAULT_AUTONOMY.limits },
    updatedAt: 0,
    updatedBy: "owner",
    ...patch,
  };
}

const istanbulWeekdays = {
  timeZone: "Europe/Istanbul",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
};

describe("autonomy levels", () => {
  it("defaults every action to suggest, including when no policy exists", () => {
    for (const action of ACTIONS) {
      expect(autonomyLevel(undefined, action)).toBe("suggest");
      expect(autonomyLevel(policy(), action)).toBe("suggest");
    }
  });

  it("returns the stored level per action", () => {
    const configured = policy({ levels: { ...DEFAULT_AUTONOMY.levels, reply: "autonomous" } });
    expect(autonomyLevel(configured, "reply")).toBe("autonomous");
    expect(autonomyLevel(configured, "publish")).toBe("suggest");
  });

  it("ships the documented daily limits", () => {
    expect(DEFAULT_AUTONOMY.limits).toEqual({
      publish: 10,
      reply: 100,
      comment: 50,
      message: 50,
      email: 100,
      outreach: 200,
      audience: 2000,
      contacts: 2000,
    });
  });
});

describe("working hours", () => {
  it("is always open when no window is configured", () => {
    expect(withinWorkingHours(policy(), Date.parse("2026-11-07T03:00:00Z"))).toBe(true);
    expect(nextWorkingStart(policy(), Date.parse("2026-11-07T03:00:00Z"))).toBe(
      Date.parse("2026-11-07T03:00:00Z"),
    );
  });

  it("uses the policy time zone for the window and end is exclusive", () => {
    const hours = policy({ workingHours: istanbulWeekdays });
    // Monday 2026-11-09 09:30 in Istanbul (UTC+3).
    expect(withinWorkingHours(hours, Date.parse("2026-11-09T06:30:00Z"))).toBe(true);
    // 08:30 in Istanbul is before the window.
    expect(withinWorkingHours(hours, Date.parse("2026-11-09T05:30:00Z"))).toBe(false);
    // 18:00 exactly is outside.
    expect(withinWorkingHours(hours, Date.parse("2026-11-09T15:00:00Z"))).toBe(false);
  });

  it("respects the allowed weekdays", () => {
    const hours = policy({ workingHours: istanbulWeekdays });
    // Saturday 2026-11-07 12:00 in Istanbul.
    expect(withinWorkingHours(hours, Date.parse("2026-11-07T09:00:00Z"))).toBe(false);
  });

  it("supports windows that span midnight", () => {
    const night = policy({
      workingHours: { timeZone: "UTC", days: [1], start: "22:00", end: "06:00" },
    });
    // Monday 23:00 is inside the Monday window.
    expect(withinWorkingHours(night, Date.parse("2026-11-09T23:00:00Z"))).toBe(true);
    // Tuesday 03:00 belongs to the window that started Monday night.
    expect(withinWorkingHours(night, Date.parse("2026-11-10T03:00:00Z"))).toBe(true);
    // Tuesday 23:00 starts a window on a day that is not allowed.
    expect(withinWorkingHours(night, Date.parse("2026-11-10T23:00:00Z"))).toBe(false);
    // Tuesday 12:00 is between the two parts.
    expect(withinWorkingHours(night, Date.parse("2026-11-10T12:00:00Z"))).toBe(false);
  });

  it("treats equal start and end as all day on allowed days", () => {
    const allDay = policy({
      workingHours: { timeZone: "UTC", days: [6], start: "00:00", end: "00:00" },
    });
    expect(withinWorkingHours(allDay, Date.parse("2026-11-07T00:10:00Z"))).toBe(true);
    expect(withinWorkingHours(allDay, Date.parse("2026-11-09T12:00:00Z"))).toBe(false);
  });

  it("returns now when already open and the next opening otherwise", () => {
    const hours = policy({ workingHours: istanbulWeekdays });
    const open = Date.parse("2026-11-09T06:30:00Z");
    expect(nextWorkingStart(hours, open)).toBe(open);
    // Saturday 15:00 in Istanbul: the next window opens Monday 09:00 Istanbul.
    expect(nextWorkingStart(hours, Date.parse("2026-11-07T12:00:00Z"))).toBe(
      Date.parse("2026-11-09T06:00:00Z"),
    );
  });

  it("finds the next opening of an overnight window", () => {
    const night = policy({
      workingHours: { timeZone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" },
    });
    // Saturday 12:00 UTC is between windows; the next one opens 22:00 the same day.
    expect(nextWorkingStart(night, Date.parse("2026-11-07T12:00:00Z"))).toBe(
      Date.parse("2026-11-07T22:00:00Z"),
    );
  });

  it("keeps wall-clock opening times across a DST change", () => {
    const hours = policy({
      workingHours: {
        timeZone: "America/New_York",
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "17:00",
      },
    });
    // Saturday 2026-03-07 before the spring-forward change on Sunday 2026-03-08.
    // Monday 09:00 is already on EDT (UTC-4), so the instant is 13:00 UTC.
    expect(nextWorkingStart(hours, Date.parse("2026-03-07T12:00:00Z"))).toBe(
      Date.parse("2026-03-09T13:00:00Z"),
    );
    expect(withinWorkingHours(hours, Date.parse("2026-03-09T13:30:00Z"))).toBe(true);
  });

  it("returns infinity when no allowed day exists", () => {
    const never = policy({
      workingHours: { timeZone: "UTC", days: [], start: "09:00", end: "17:00" },
    });
    expect(nextWorkingStart(never, Date.parse("2026-11-07T12:00:00Z"))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
