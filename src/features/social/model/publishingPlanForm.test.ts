import { describe, expect, it } from "vitest";
import {
  publishingPlanTime,
  publishingSchedule,
  publishingScheduleSummary,
  scheduleFields,
  type PublishingScheduleFields,
} from "./publishingPlanForm";

const fields: PublishingScheduleFields = {
  timeZone: "Europe/Istanbul",
  startTime: "09:00",
  endTime: "18:00",
  minHours: "2",
  maxHours: "5",
};

describe("Publishing plan form", () => {
  it("converts owner hour ranges without losing fractional-hour precision", () => {
    const result = publishingSchedule({ ...fields, minHours: "1.5", maxHours: "2.25" });
    expect(result.schedule).toEqual({
      timeZone: "Europe/Istanbul",
      startTime: "09:00",
      endTime: "18:00",
      minIntervalMinutes: 90,
      maxIntervalMinutes: 135,
    });
    expect(scheduleFields(result.schedule!)).toEqual({
      ...fields,
      minHours: "1.5",
      maxHours: "2.25",
    });
  });

  it("rejects malformed times, timezones, empty values, inverted and non-minute intervals", () => {
    for (const change of [
      { startTime: "25:00" },
      { endTime: "9:00" },
      { timeZone: "Istanbul/unknown" },
      { minHours: "" },
      { minHours: "0" },
      { minHours: "6" },
      { maxHours: "169" },
      { minHours: "0.123" },
    ])
      expect(publishingSchedule({ ...fields, ...change }).error).toBeTruthy();
  });

  it("explains overnight windows, full days and fixed intervals honestly", () => {
    expect(
      publishingScheduleSummary(
        publishingSchedule({ ...fields, startTime: "22:00", endTime: "03:00" }).schedule!,
      ),
    ).toContain("gece yarısını geçer");
    expect(
      publishingScheduleSummary(
        publishingSchedule({ ...fields, startTime: "00:00", endTime: "00:00", maxHours: "2" })
          .schedule!,
      ),
    ).toContain("günün tamamında, 2 saatte bir");
    expect(publishingScheduleSummary(publishingSchedule(fields).schedule!)).toContain(
      "en az 2, en çok 5 saat",
    );
    expect(publishingScheduleSummary(publishingSchedule(fields).schedule!)).toContain(
      "bir sonraki başlangıç saatini bekler",
    );
  });

  it("formats run dates in the selected timezone and handles unavailable dates", () => {
    expect(publishingPlanTime(Date.UTC(2026, 9, 12, 6), "Europe/Istanbul")).toContain("09:00");
    expect(publishingPlanTime(undefined, "Europe/Istanbul")).toBe("—");
    expect(publishingPlanTime(Number.NaN, "Europe/Istanbul")).toBe("—");
  });
});
