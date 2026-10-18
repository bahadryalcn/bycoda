import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "./store";
import { HostLimits, localDay } from "./limits";

const stores: HostStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("calendar day agent budget", () => {
  it("keeps active and settled usage continuous across midnight", () => {
    const store = new HostStore(":memory:");
    stores.push(store);
    const start = new Date(2026, 9, 17, 23).getTime();
    const end = new Date(2026, 9, 18, 0, 5).getTime();
    const limits = new HostLimits(store, () => end);
    limits.save({ dailyAgentMinutes: 30 });
    let active = [start];
    limits.track(() => active);
    expect(limits.usedMinutes()).toBe(5);
    limits.record(start, end);
    active = [];
    expect(limits.usedMinutes()).toBe(5);
    expect(limits.reached()).toBe(false);
    expect(
      store.db.prepare("SELECT ms FROM agent_usage WHERE day=?").get(localDay(start))?.ms,
    ).toBe(60 * 60000);
  });

  it("preserves elapsed time over multiple calendar days and exact midnight", () => {
    const store = new HostStore(":memory:");
    stores.push(store);
    const start = new Date(2026, 2, 7, 23).getTime();
    const end = new Date(2026, 2, 10).getTime();
    const limits = new HostLimits(store, () => end);
    limits.record(start, end);
    const rows = store.db.prepare("SELECT day, ms FROM agent_usage ORDER BY day").all();
    expect(rows.map((row) => row.day)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(rows.reduce((sum, row) => sum + Number(row.ms), 0)).toBe(end - start);
    const dayStart = new Date(2026, 2, 8).getTime();
    const dayEnd = new Date(2026, 2, 9).getTime();
    expect(rows[1]?.ms).toBe(dayEnd - dayStart);
    if (process.env.TZ === "America/New_York") expect(rows[1]?.ms).toBe(23 * 60 * 60000);
    expect(limits.usedMinutes()).toBe(0);
  });

  it("preserves the extra hour on a daylight-saving fall-back day", () => {
    const store = new HostStore(":memory:");
    stores.push(store);
    const start = new Date(2026, 10, 1).getTime();
    const end = new Date(2026, 10, 2).getTime();
    const limits = new HostLimits(store, () => end);
    limits.record(start, end);
    const row = store.db.prepare("SELECT ms FROM agent_usage WHERE day=?").get("2026-11-01");
    expect(row?.ms).toBe(end - start);
    if (process.env.TZ === "America/New_York") expect(row?.ms).toBe(25 * 60 * 60000);
  });
});
