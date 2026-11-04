import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "./store";
import { HostLimits, localDay } from "./limits";
import { confirmedRunElapsed, forgetRunSamples } from "./run-duration";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of await stores.splice(0)) await store.close();
});

describe("calendar day agent budget", () => {
  it("holds new work on an unobserved legacy run without changing legacy usage", async () => {
    const store = new HostStore(":memory:");
    stores.push(store);
    let now = new Date(2026, 9, 17, 12).getTime();
    const limits = new HostLimits(store, () => now);
    await limits.ready;
    await store.db.prepare("INSERT INTO agent_usage VALUES (?,?)").run(localDay(now), 120_000);
    await limits.recordRun({ sessionId: "legacy", runId: "run" }, now);
    await limits.save({ dailyAgentMinutes: 10 });
    expect(await limits.state()).toMatchObject({
      usedMinutes: 2,
      usageUncertain: true,
      limitReached: true,
    });
    forgetRunSamples(store, "legacy", "run");
    await limits.recordRun({ sessionId: "legacy", runId: "run" }, now);
    expect(await limits.state()).toMatchObject({
      usedMinutes: 2,
      usageUncertain: true,
      limitReached: true,
    });
    await limits.save({ dailyAgentMinutes: 0 });
    expect(await limits.reached()).toBe(false);
    now = new Date(2026, 9, 18, 0, 0, 1).getTime();
    expect(await limits.state()).toMatchObject({ usedMinutes: 0, limitReached: false });
  });
  it("keeps legacy usage and counts confirmed intervals once across midnight, gaps and restart", async () => {
    const store = new HostStore(":memory:");
    stores.push(store);
    let now = new Date(2026, 9, 17, 23, 59, 30).getTime();
    const limits = new HostLimits(store, () => now);
    await limits.ready;
    await limits.recordRun({ sessionId: "session", runId: "run" }, now);
    await store.db
      .prepare("INSERT INTO agent_usage VALUES (?,?)")
      .run(localDay(now + 60_000), 60_000);
    await confirmedRunElapsed(store, "session", "run", now, 0);
    now += 60_000;
    await confirmedRunElapsed(store, "session", "run", now, 60_000);
    expect(await limits.usedMinutes()).toBe(1.5);
    now += 3_600_000;
    await confirmedRunElapsed(store, "session", "run", now, 3_660_000);
    expect(await limits.usedMinutes()).toBe(1.5);
    await limits.save({ dailyAgentMinutes: 10 });
    expect(await limits.state()).toMatchObject({ usageUncertain: true, limitReached: true });
    forgetRunSamples(store, "session", "run");
    await confirmedRunElapsed(store, "session", "run", now, 0);
    now += 30_000;
    await confirmedRunElapsed(store, "session", "run", now, 30_000);
    expect(await limits.usedMinutes()).toBe(2);
  });
  it("keeps active and settled usage continuous across midnight", async () => {
    const store = new HostStore(":memory:");
    await stores.push(store);
    const start = new Date(2026, 9, 17, 23).getTime();
    const end = new Date(2026, 9, 18, 0, 5).getTime();
    const limits = new HostLimits(store, () => end);
    await limits.save({ dailyAgentMinutes: 30 });
    let active = [start];
    limits.track(() => active);
    expect(await limits.usedMinutes()).toBe(5);
    await limits.record(start, end);
    active = [];
    expect(await limits.usedMinutes()).toBe(5);
    expect(await limits.reached()).toBe(false);
    expect(
      (await store.db.prepare("SELECT ms FROM agent_usage WHERE day=?").get(localDay(start)))?.ms,
    ).toBe(60 * 60000);
  });

  it("preserves elapsed time over multiple calendar days and exact midnight", async () => {
    const store = new HostStore(":memory:");
    await stores.push(store);
    const start = new Date(2026, 2, 7, 23).getTime();
    const end = new Date(2026, 2, 10).getTime();
    const limits = new HostLimits(store, () => end);
    await limits.record(start, end);
    const rows = await store.db.prepare("SELECT day, ms FROM agent_usage ORDER BY day").all();
    expect(rows.map((row) => row.day)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(rows.reduce((sum, row) => sum + Number(row.ms), 0)).toBe(end - start);
    const dayStart = new Date(2026, 2, 8).getTime();
    const dayEnd = new Date(2026, 2, 9).getTime();
    expect(rows[1]?.ms).toBe(dayEnd - dayStart);
    if (process.env.TZ === "America/New_York") expect(rows[1]?.ms).toBe(23 * 60 * 60000);
    expect(await limits.usedMinutes()).toBe(0);
  });

  it("preserves the extra hour on a daylight-saving fall-back day", async () => {
    const store = new HostStore(":memory:");
    await stores.push(store);
    const start = new Date(2026, 10, 1).getTime();
    const end = new Date(2026, 10, 2).getTime();
    const limits = new HostLimits(store, () => end);
    await limits.record(start, end);
    const row = await store.db.prepare("SELECT ms FROM agent_usage WHERE day=?").get("2026-11-01");
    expect(row?.ms).toBe(end - start);
    if (process.env.TZ === "America/New_York") expect(row?.ms).toBe(25 * 60 * 60000);
  });
});
