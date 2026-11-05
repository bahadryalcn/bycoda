import { describe, expect, it } from "vitest";
import { addCivilDays, ownerDay, ownerDayBounds } from "./ownerDay";

describe("owner civil days", () => {
  it("uses the owner zone across year and DST boundaries", () => {
    expect(ownerDay(Date.parse("2025-01-01T00:30:00Z"), "America/New_York")).toBe("2024-12-31");
    expect(ownerDay(Date.parse("2025-03-09T07:30:00Z"), "America/New_York")).toBe("2025-03-09");
    expect(addCivilDays("2025-03-09", 1)).toBe("2025-03-10");
    expect(ownerDayBounds(Date.parse("2025-03-09T12:00:00Z"), "America/New_York")).toEqual({ start: Date.parse("2025-03-09T05:00:00Z"), end: Date.parse("2025-03-10T04:00:00Z") });
    expect(ownerDayBounds(Date.parse("2025-11-02T12:00:00Z"), "America/New_York")).toEqual({ start: Date.parse("2025-11-02T04:00:00Z"), end: Date.parse("2025-11-03T05:00:00Z") });
    expect(addCivilDays("2024-12-31", 1)).toBe("2025-01-01");
  });
  it("rejects invalid dates and zones", () => {
    expect(ownerDay(NaN, "UTC")).toBeUndefined();
    expect(ownerDay(0, "invalid/zone")).toBeUndefined();
    expect(addCivilDays("2025-02-30", 1)).toBeUndefined();
  });
});
