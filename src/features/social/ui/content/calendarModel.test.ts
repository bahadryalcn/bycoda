import { describe, expect, it } from "vitest";
import type { SocialAccount, SocialJob } from "../../model/social";
import {
  calendarEntries,
  dayKey,
  entriesByDay,
  isToday,
  monthCells,
  shiftMonth,
  splitMonthEntries,
  startOfDay,
  weekDays,
} from "./calendarModel";

const local = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).getTime();

describe("calendar ranges", () => {
  it("starts the week on Monday by default and covers seven days", () => {
    const days = weekDays(local(2026, 11, 11)); // a Wednesday
    expect(days).toHaveLength(7);
    expect(dayKey(days[0]!)).toBe("2026-11-09");
    expect(dayKey(days[6]!)).toBe("2026-11-15");
  });

  it("starts on Sunday when asked", () => {
    expect(dayKey(weekDays(local(2026, 11, 11), 0)[0]!)).toBe("2026-11-08");
  });

  it("builds six full weeks for a month, starting on the week day before the 1st", () => {
    const cells = monthCells(local(2026, 11, 7));
    expect(cells).toHaveLength(42);
    expect(dayKey(cells[0]!)).toBe("2026-10-26");
    expect(cells.map(dayKey)).toContain("2026-11-30");
  });

  it("moves a month without overflowing into the next one", () => {
    expect(dayKey(shiftMonth(local(2026, 1, 31), 1))).toBe("2026-02-28");
    expect(dayKey(shiftMonth(local(2026, 3, 31), -1))).toBe("2026-02-28");
  });

  it("returns local midnight for the day of a timestamp", () => {
    expect(startOfDay(local(2026, 11, 7, 17))).toBe(local(2026, 11, 7, 0));
  });
});

describe("calendar entries", () => {
  const accounts = [{ id: "x1", platform: "x" }] as SocialAccount[];
  const job = (patch: Partial<SocialJob>): SocialJob =>
    ({
      id: "j1",
      operationId: "o",
      dedupeKey: "d",
      accountId: "x1",
      projectIds: ["p1"],
      provider: "x",
      campaignId: "c1",
      kind: "publish",
      payload: { text: "Hello", media: [] },
      status: "queued",
      scheduledAt: local(2026, 11, 8, 10),
      attempts: 0,
      createdAt: 1,
      actorId: "a",
      ...patch,
    }) as SocialJob;

  it("keeps only publish jobs that belong to a campaign, in time order", () => {
    const entries = calendarEntries(
      [
        job({ id: "late", scheduledAt: local(2026, 11, 9, 10) }),
        job({ id: "early", scheduledAt: local(2026, 11, 8, 10), status: "succeeded" }),
        job({ id: "reply", kind: "reply" }),
        job({ id: "loose", campaignId: undefined }),
      ],
      accounts,
    );
    expect(entries.map((entry) => entry.id)).toEqual(["early", "late"]);
    expect(entries[0]!.platform).toBe("x");
    expect(entries[0]!.status).toBe("succeeded");
  });

  it("groups entries by their local day", () => {
    const entries = calendarEntries(
      [
        job({ id: "a", scheduledAt: local(2026, 11, 8, 8) }),
        job({ id: "b", scheduledAt: local(2026, 11, 8, 20) }),
      ],
      accounts,
    );
    const byDay = entriesByDay(entries);
    expect(byDay.get("2026-11-08")?.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("isToday", () => {
  it("matches any time on the same local date only", () => {
    const now = local(2026, 11, 7, 15);
    expect(isToday(local(2026, 11, 7, 0), now)).toBe(true);
    expect(isToday(local(2026, 11, 8, 0), now)).toBe(false);
  });
});

describe("splitMonthEntries", () => {
  it("keeps the first entries and counts the rest", () => {
    expect(splitMonthEntries([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(splitMonthEntries([1], 3)).toEqual({ shown: [1], more: 0 });
  });
});
