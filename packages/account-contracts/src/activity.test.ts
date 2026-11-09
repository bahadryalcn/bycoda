import { describe, expect, it } from "vitest";
import {
  ActivityDay,
  ActivityDaysUpload,
  addDays,
  countMinutes,
  decodeMinutes,
  emptyMinutes,
  encodeMinutes,
  isMinuteSet,
  isoWeekStart,
  localDateFor,
  mergeMinutes,
  minuteIndexFor,
  setMinute,
  summarize,
} from "./activity.ts";

function mapOf(...indexes: number[]): Uint8Array {
  const map = emptyMinutes();
  for (const index of indexes) setMinute(map, index);
  return map;
}

function day(date: string, deviceId: string, map: Uint8Array, timeZone = "Europe/Istanbul") {
  return { date, timeZone, deviceId, minutes: encodeMinutes(map) };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

describe("minute maps", () => {
  it("starts empty with 180 bytes", () => {
    const map = emptyMinutes();
    expect(map.length).toBe(180);
    expect(countMinutes(map)).toBe(0);
  });

  it("sets, reads and counts minutes including the edges", () => {
    const map = mapOf(0, 7, 8, 1439, 1439);
    expect(isMinuteSet(map, 0)).toBe(true);
    expect(isMinuteSet(map, 1)).toBe(false);
    expect(isMinuteSet(map, 8)).toBe(true);
    expect(isMinuteSet(map, 1439)).toBe(true);
    expect(countMinutes(map)).toBe(4);
  });

  it("rejects out-of-range indexes and wrong map sizes", () => {
    const map = emptyMinutes();
    expect(() => setMinute(map, -1)).toThrow(RangeError);
    expect(() => setMinute(map, 1440)).toThrow(RangeError);
    expect(() => setMinute(map, 1.5)).toThrow(RangeError);
    expect(() => isMinuteSet(map, 1440)).toThrow(RangeError);
    expect(() => countMinutes(new Uint8Array(10))).toThrow(RangeError);
    expect(() => encodeMinutes(new Uint8Array(179))).toThrow(RangeError);
    expect(() => mergeMinutes(map, new Uint8Array(181))).toThrow(RangeError);
  });

  it("round-trips through base64 with 240 characters and no padding", () => {
    const map = mapOf(0, 1, 2, 500, 1439);
    const encoded = encodeMinutes(map);
    expect(encoded).toHaveLength(240);
    expect(encoded).not.toContain("=");
    expect(decodeMinutes(encoded)).toEqual(map);
    expect(encodeMinutes(emptyMinutes())).toBe("A".repeat(240));
  });

  it("matches the platform base64 for arbitrary bytes", () => {
    const bytes = new Uint8Array(180).map((_, i) => (i * 37 + 11) % 256);
    expect(encodeMinutes(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(decodeMinutes(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
  });

  it("uses least-significant-bit-first wire order", () => {
    const map = mapOf(0);
    expect(map[0]).toBe(1);
    expect(mapOf(9)[1]).toBe(2);
  });

  it("rejects invalid lengths and characters when decoding", () => {
    expect(() => decodeMinutes("")).toThrow(RangeError);
    expect(() => decodeMinutes("A".repeat(239))).toThrow(RangeError);
    expect(() => decodeMinutes("A".repeat(244))).toThrow(RangeError);
    expect(() => decodeMinutes("A".repeat(239) + "=")).toThrow(RangeError);
    expect(() => decodeMinutes("A".repeat(239) + "-")).toThrow(RangeError);
  });
});

describe("mergeMinutes", () => {
  const a = mapOf(...range(0, 10));
  const b = mapOf(...range(5, 20));

  it("is a bitwise OR", () => {
    expect(countMinutes(mergeMinutes(a, b))).toBe(20);
  });

  it("is idempotent", () => {
    const once = mergeMinutes(a, b);
    expect(mergeMinutes(once, b)).toEqual(once);
    expect(mergeMinutes(a, a)).toEqual(a);
  });

  it("is commutative and associative", () => {
    const c = mapOf(1000, 1001);
    expect(mergeMinutes(a, b)).toEqual(mergeMinutes(b, a));
    expect(mergeMinutes(mergeMinutes(a, b), c)).toEqual(mergeMinutes(a, mergeMinutes(b, c)));
  });

  it("does not mutate inputs", () => {
    const copy = a.slice();
    mergeMinutes(a, b);
    expect(a).toEqual(copy);
  });
});

describe("minuteIndexFor and localDateFor", () => {
  it("indexes by local wall-clock minute", () => {
    const instant = new Date("2026-11-08T10:30:00Z");
    expect(minuteIndexFor(instant, "UTC")).toBe(630);
    expect(minuteIndexFor(instant, "Europe/Istanbul")).toBe(13 * 60 + 30);
    expect(localDateFor(instant, "Europe/Istanbul")).toBe("2026-11-08");
  });

  it("handles the local midnight boundary", () => {
    const beforeMidnight = new Date("2026-11-08T20:59:00Z");
    const atMidnight = new Date("2026-11-08T21:00:00Z");
    expect(localDateFor(beforeMidnight, "Europe/Istanbul")).toBe("2026-11-08");
    expect(minuteIndexFor(beforeMidnight, "Europe/Istanbul")).toBe(1439);
    expect(localDateFor(atMidnight, "Europe/Istanbul")).toBe("2026-11-09");
    expect(minuteIndexFor(atMidnight, "Europe/Istanbul")).toBe(0);
  });

  it("returns different dates for different zones at the same instant", () => {
    const instant = new Date("2026-03-01T23:30:00Z");
    expect(localDateFor(instant, "America/New_York")).toBe("2026-03-01");
    expect(localDateFor(instant, "Asia/Tokyo")).toBe("2026-03-02");
    expect(minuteIndexFor(instant, "Asia/Tokyo")).toBe(8 * 60 + 30);
  });

  it("never returns 1440 for midnight (hour 24 quirk)", () => {
    expect(minuteIndexFor(new Date("2026-06-01T00:00:00Z"), "UTC")).toBe(0);
  });

  it("spring forward in Berlin: skipped hour has no slots", () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST.
    const last = new Date("2026-03-29T00:59:00Z"); // 01:59 CET
    const next = new Date("2026-03-29T01:00:00Z"); // 03:00 CEST
    expect(minuteIndexFor(last, "Europe/Berlin")).toBe(1 * 60 + 59);
    expect(minuteIndexFor(next, "Europe/Berlin")).toBe(3 * 60);
    expect(localDateFor(next, "Europe/Berlin")).toBe("2026-03-29");

    const map = emptyMinutes();
    for (
      let t = Date.parse("2026-03-28T23:00:00Z");
      t < Date.parse("2026-03-29T22:00:00Z");
      t += 60_000
    ) {
      setMinute(map, minuteIndexFor(new Date(t), "Europe/Berlin"));
    }
    // A full 23h local day: the 02:00-02:59 slots stay empty.
    expect(countMinutes(map)).toBe(1440 - 60);
    expect(isMinuteSet(map, 2 * 60 + 30)).toBe(false);
  });

  it("fall back in New York: repeated hour ORs into the same slots", () => {
    // 2026-11-01: 02:00 EDT falls back to 01:00 EST, so 01:00-01:59 happens twice.
    const first = new Date("2026-11-01T05:30:00Z"); // 01:30 EDT
    const second = new Date("2026-11-01T06:30:00Z"); // 01:30 EST
    expect(minuteIndexFor(first, "America/New_York")).toBe(90);
    expect(minuteIndexFor(second, "America/New_York")).toBe(90);

    const map = emptyMinutes();
    for (
      let t = Date.parse("2026-11-01T04:00:00Z");
      t < Date.parse("2026-11-02T05:00:00Z");
      t += 60_000
    ) {
      setMinute(map, minuteIndexFor(new Date(t), "America/New_York"));
    }
    // A 25h local day still fills exactly 1440 slots, never more.
    expect(countMinutes(map)).toBe(1440);
  });

  it("Europe/Istanbul has no DST: always UTC+3", () => {
    expect(minuteIndexFor(new Date("2026-01-15T00:00:00Z"), "Europe/Istanbul")).toBe(180);
    expect(minuteIndexFor(new Date("2026-07-15T00:00:00Z"), "Europe/Istanbul")).toBe(180);
  });
});

describe("calendar helpers", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("finds the Monday of an ISO week", () => {
    expect(isoWeekStart("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(isoWeekStart("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(isoWeekStart("2026-11-04")).toBe("2026-11-02");
    expect(isoWeekStart("2026-01-01")).toBe("2025-12-29");
  });
});

describe("summarize", () => {
  const options = { today: "2026-11-08", timeZone: "Europe/Istanbul" };

  it("returns zeros and a zero-filled week without data", () => {
    const summary = summarize([], options);
    expect(summary).toMatchObject({ today: 0, week: 0, month: 0, year: 0 });
    expect(summary.last7Days.map((d) => d.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(summary.perDevice).toBeUndefined();
  });

  it("totals today, ISO week (Monday start), month and year", () => {
    const days = [
      day("2026-11-08", "d1", mapOf(...range(0, 30))), // Sunday: today, in week
      day("2026-11-02", "d1", mapOf(...range(0, 60))), // Monday: week start
      day("2026-11-01", "d1", mapOf(...range(0, 100))), // Sunday before: month only
      day("2026-10-31", "d1", mapOf(...range(0, 200))), // year only
      day("2025-12-31", "d1", mapOf(...range(0, 400))), // previous year
    ];
    const summary = summarize(days, options);
    expect(summary.today).toBe(30);
    expect(summary.week).toBe(90);
    expect(summary.month).toBe(190);
    expect(summary.year).toBe(390);
    expect(summary.last7Days.at(-1)).toEqual({ date: "2026-11-08", minutes: 30 });
    expect(summary.last7Days[0]).toEqual({ date: "2026-11-02", minutes: 60 });
  });

  it("week spans month and year boundaries", () => {
    const days = [day("2025-12-29", "d1", mapOf(1, 2)), day("2026-01-01", "d1", mapOf(1))];
    const summary = summarize(days, { today: "2026-01-01", timeZone: "UTC" });
    expect(summary.week).toBe(3);
    expect(summary.month).toBe(1);
    expect(summary.year).toBe(1);
  });

  it("counts overlapping devices once and reports each device", () => {
    const days = [
      day("2026-11-08", "phone", mapOf(...range(0, 10))),
      day("2026-11-08", "laptop", mapOf(...range(5, 20))),
    ];
    const summary = summarize(days, { ...options, perDevice: true });
    expect(summary.today).toBe(20);
    expect(summary.perDevice).toEqual([
      { deviceId: "laptop", today: 15, week: 15, month: 15, year: 15 },
      { deviceId: "phone", today: 10, week: 10, month: 10, year: 10 },
    ]);
  });

  it("reports the last 12 calendar months, oldest first, across a year boundary", () => {
    const days = [
      day("2026-02-10", "d1", mapOf(1, 2, 3)),
      day("2026-02-11", "d2", mapOf(1)),
      day("2025-03-01", "d1", mapOf(1, 2)),
      day("2025-02-28", "d1", mapOf(1)), // outside the window
      day("2026-11-08", "d1", mapOf(1, 2, 3, 4)),
    ];
    const months = summarize(days, options).last12Months!;
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.month)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(months.find((m) => m.month === "2026-02")?.minutes).toBe(4);
    expect(months.at(-1)).toEqual({ month: "2026-11", minutes: 4 });
  });

  it("is idempotent when the same upload is repeated", () => {
    const one = day("2026-11-08", "d1", mapOf(1, 2, 3));
    expect(summarize([one, one, one], options)).toEqual(summarize([one], options));
  });

  it("derives today from an instant in the given zone", () => {
    const instant = new Date("2026-11-08T21:30:00Z"); // already the 9th in Istanbul
    const summary = summarize([day("2026-11-09", "d1", mapOf(1))], {
      today: instant,
      timeZone: "Europe/Istanbul",
    });
    expect(summary.today).toBe(1);
    expect(summary.last7Days.at(-1)?.date).toBe("2026-11-09");
  });

  it("sums a full year of days", () => {
    const days = [];
    for (let i = 0; i < 365; i++)
      days.push(day(addDays("2026-01-01", i), "d1", mapOf(...range(0, 60))));
    const summary = summarize(days, { today: "2026-12-31", timeZone: "UTC" });
    expect(summary.year).toBe(365 * 60);
    expect(summary.month).toBe(31 * 60);
    expect(summary.week).toBe(4 * 60); // Mon 2026-12-28 .. Thu 12-31 in the dataset
  });

  it("throws for a malformed minute map", () => {
    expect(() =>
      summarize([{ date: "2026-11-08", timeZone: "UTC", deviceId: "d", minutes: "AAAA" }], options),
    ).toThrow(RangeError);
  });
});

describe("activity schemas", () => {
  const valid = day("2026-11-08", "d1", mapOf(1));

  it("accepts a valid day and rejects bad shape", () => {
    expect(ActivityDay.safeParse(valid).success).toBe(true);
    expect(ActivityDay.safeParse({ ...valid, minutes: "AAAA" }).success).toBe(false);
    expect(ActivityDay.safeParse({ ...valid, date: "2026-02-30" }).success).toBe(false);
    expect(ActivityDay.safeParse({ ...valid, timeZone: "Mars/Base" }).success).toBe(false);
  });

  it("rejects unknown fields such as project or path", () => {
    expect(ActivityDay.safeParse({ ...valid, project: "secret" }).success).toBe(false);
    expect(ActivityDaysUpload.safeParse({ days: [valid], path: "/x" }).success).toBe(false);
  });

  it("limits an upload to 62 days and at least one", () => {
    expect(ActivityDaysUpload.safeParse({ days: Array(62).fill(valid) }).success).toBe(true);
    expect(ActivityDaysUpload.safeParse({ days: Array(63).fill(valid) }).success).toBe(false);
    expect(ActivityDaysUpload.safeParse({ days: [] }).success).toBe(false);
  });
});
