import { expect, it } from "vitest";
import { chiefBriefingCycle, chiefContextLimits } from "./assistant-chief-policy";
it("bounds rotation by an actual smaller model window without raising an owner limit", () => {
  expect(chiefContextLimits({ soft: 150000, hard: 250000 }, 128000)).toEqual({
    soft: 76800,
    hard: 102400,
  });
  expect(chiefContextLimits({ soft: 10000, hard: 20000 }, 1000000)).toEqual({
    soft: 10000,
    hard: 20000,
  });
  expect(chiefContextLimits({ soft: 150000, hard: 250000 })).toEqual({
    soft: 150000,
    hard: 250000,
  });
});
it("rotates on the configured local briefing boundary rather than midnight", () => {
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 10, day, hour, minute).getTime();
  expect(chiefBriefingCycle(at(2, 23), "09:00")).toBe("2026-11-02");
  expect(chiefBriefingCycle(at(3, 0), "09:00")).toBe("2026-11-02");
  expect(chiefBriefingCycle(at(3, 8, 59), "09:00")).toBe("2026-11-02");
  expect(chiefBriefingCycle(at(3, 9), "09:00")).toBe("2026-11-03");
  expect(chiefBriefingCycle(at(3, 9), "11:30")).toBe("2026-11-02");
  expect(chiefBriefingCycle(new Date(2027, 0, 1, 8).getTime())).toBe("2026-12-31");
});
