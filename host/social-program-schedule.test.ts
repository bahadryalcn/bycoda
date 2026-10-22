import { describe, expect, it } from "vitest";
import { defaultProgram } from "../src/features/social/model/socialProgram";
import {
  parseProgramSchedule,
  nextProgramSlot,
  followingProgramSlot,
  previewProgramSchedule,
  programWindow,
} from "./social-program-schedule";
import {
  parseProgramConfig,
  nearDuplicate,
  validateGeneratedClaims,
} from "./social-program-config";
const at = (s: string) => Date.parse(s);
describe("program schedule V2", () => {
  it("keeps the remaining slots of the previous weekday's overnight window", () => {
    const s = parseProgramSchedule({
      ...defaultProgram().schedule,
      mode: "frequency",
      period: "day",
      frequency: 4,
      timeZone: "UTC",
      days: [1],
      startTime: "22:00",
      endTime: "02:00",
      startsAt: at("2026-10-12T22:00:00Z"),
      endsAt: at("2026-10-13T03:00:00Z"),
    });
    expect(nextProgramSlot(s, at("2026-10-13T00:01:00Z"))).toBe(at("2026-10-13T01:00:00Z"));
    expect(followingProgramSlot(s, at("2026-10-13T00:00:00Z"), "campaign", 3)).toBe(
      at("2026-10-13T01:00:00Z"),
    );
    expect(previewProgramSchedule(s)).toEqual(
      [
        "2026-10-12T22:00:00Z",
        "2026-10-12T23:00:00Z",
        "2026-10-13T00:00:00Z",
        "2026-10-13T01:00:00Z",
      ].map(at),
    );
  });

  it("rejects frequencies that cannot fit distinct minutes in each allocated day", () => {
    const schedule = {
      ...defaultProgram().schedule,
      mode: "frequency",
      period: "day",
      frequency: 2,
      timeZone: "UTC",
      days: [1],
      startTime: "09:00",
      endTime: "09:01",
      startsAt: at("2026-10-12T00:00:00Z"),
      endsAt: at("2026-10-12T23:59:00Z"),
    };
    expect(() => parseProgramSchedule(schedule)).toThrow("distinct minute");
    expect(() =>
      parseProgramSchedule({ ...schedule, period: "week", days: [1, 2], frequency: 3 }),
    ).toThrow("distinct minute");
    expect(
      previewProgramSchedule(parseProgramSchedule({ ...schedule, endTime: "09:02" })),
    ).toHaveLength(2);
  });
  it("holds unsupported numeric promises and links for review", () => {
    expect(() =>
      validateGeneratedClaims("Save 50% for 30 days", "Owner supplied workflow"),
    ).toThrow("not supported");
    expect(() =>
      validateGeneratedClaims("Visit https://unapproved.test", "Owner supplied workflow"),
    ).toThrow("unapproved link");
    expect(() => validateGeneratedClaims("Save 50%", "Owner verified: save 50%")).not.toThrow();
  });
  it("resolves daily and multiple fixed local times", () => {
    const s = {
      ...defaultProgram().schedule,
      timeZone: "Europe/Istanbul",
      startsAt: at("2026-10-14T00:00:00Z"),
      times: ["09:00", "15:00"],
    };
    expect(previewProgramSchedule(s, 3)).toEqual([
      at("2026-10-14T06:00:00Z"),
      at("2026-10-14T12:00:00Z"),
      at("2026-10-15T06:00:00Z"),
    ]);
  });
  it("publishes once during a DST fold and advances gaps to the first valid minute", () => {
    const s = {
      ...defaultProgram().schedule,
      timeZone: "America/New_York",
      times: ["02:30"],
      startsAt: at("2026-03-08T00:00:00Z"),
    };
    expect(nextProgramSlot(s, s.startsAt)).toBe(at("2026-03-08T07:00:00Z"));
    s.times = ["01:30"];
    s.startsAt = at("2026-11-01T00:00:00Z");
    const first = nextProgramSlot(s, s.startsAt)!;
    expect(first).toBe(at("2026-11-01T05:30:00Z"));
    expect(followingProgramSlot(s, first, "x", 1)).toBe(at("2026-11-02T06:30:00Z"));
  });
  it("assigns overnight windows to the starting weekday and uses stable intervals", () => {
    const s = {
      ...defaultProgram().schedule,
      mode: "interval" as const,
      timeZone: "UTC",
      days: [1],
      startTime: "22:00",
      endTime: "02:00",
      startsAt: at("2026-10-12T22:00:00Z"),
    };
    expect(programWindow(s, at("2026-10-13T01:00:00Z"))).toBe(true);
    expect(programWindow(s, at("2026-10-14T01:00:00Z"))).toBe(false);
    expect(followingProgramSlot(s, s.startsAt, "same", 1)).toBe(
      followingProgramSlot(s, s.startsAt, "same", 1),
    );
  });
  it("distributes weekly frequency across selected days and respects the end date", () => {
    const s = {
      ...defaultProgram().schedule,
      mode: "frequency" as const,
      timeZone: "UTC",
      days: [1, 3, 5],
      frequency: 5,
      period: "week" as const,
      startsAt: at("2026-10-12T00:00:00Z"),
      endsAt: at("2026-10-16T23:00:00Z"),
    };
    expect(previewProgramSchedule(s, 10)).toHaveLength(5);
  });
  it("rejects unknown fields, invalid days/timezones and unbounded budgets", () => {
    expect(() => parseProgramSchedule({ ...defaultProgram().schedule, days: [] })).toThrow();
    expect(() =>
      parseProgramSchedule({ ...defaultProgram().schedule, timeZone: "Wrong/Zone" }),
    ).toThrow();
    expect(() => parseProgramConfig({ ...defaultProgram(), enabled: true })).toThrow();
  });
  it("detects near duplicates despite punctuation and links", () => {
    expect(
      nearDuplicate(
        "Our workflow saves time. https://a.test",
        "Our workflow saves time! https://b.test",
      ),
    ).toBe(true);
    expect(
      nearDuplicate("A walkthrough of the editor", "Practical deployment steps for teams"),
    ).toBe(false);
  });
});
