import { expect, it } from "vitest";
import { legacyUtcDayKey, ownerDayKey } from "./owner-day";

it("keys a day in the owner's zone, not UTC", () => {
  const at = Date.UTC(2026, 10, 3, 23, 30); // 23:30 UTC
  expect(ownerDayKey(at, "UTC")).toBe("2026-11-03");
  expect(ownerDayKey(at, "Europe/Istanbul")).toBe("2026-11-04");
  expect(ownerDayKey(at, "America/Los_Angeles")).toBe("2026-11-03");
  expect(legacyUtcDayKey(at)).toBe("2026-11-03");
});
it("defaults to the process zone and keeps the YYYY-MM-DD format", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Pacific/Auckland";
  try {
    expect(ownerDayKey(Date.UTC(2026, 0, 1, 12, 30))).toBe("2026-01-02");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  expect(ownerDayKey(Date.UTC(2026, 0, 5))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
