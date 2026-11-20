import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import {
  SPENT_COUNTER_PRUNE_BATCH,
  SPENT_COUNTER_RETENTION_DAYS,
  SocialAudienceStore,
} from "./social-audience-store";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const dayOf = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-counter-retention-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const audience = new SocialAudienceStore(store);
  await audience.initialize();
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { audience };
}

describe("spent quota counter retention", () => {
  it("removes only day and hour counters older than the window and keeps quotas readable", async () => {
    const { audience } = await fixture();
    const old = dayOf(-(SPENT_COUNTER_RETENTION_DAYS + 3));
    const edge = dayOf(-SPENT_COUNTER_RETENTION_DAYS);
    const today = dayOf(0);
    await audience.incrementCounter("acc-a", "reply", old, 4);
    await audience.incrementCounter("acc-a", "outreach:seq", `${old}T09`, 2);
    await audience.incrementCounter("acc-b", "browser", old, 7);
    await audience.incrementCounter("acc-a", "reply", edge, 1);
    await audience.incrementCounter("acc-a", "reply", today, 5);
    await audience.incrementCounter("acc-b", "browser", today, 9);
    await audience.incrementCounter("acc-a", "outreach:seq", `${today}T11`, 3);
    // Cumulative stats are not a time window; they must survive any clock.
    await audience.incrementCounter("outreach", "outreach-stat:seq:sent", "total", 12);

    expect(await audience.pruneSpentCounters(NOW)).toBe(3);

    expect(await audience.getCounter("acc-a", "reply", old)).toBe(0);
    expect(await audience.getCounter("acc-a", "outreach:seq", `${old}T09`)).toBe(0);
    expect(await audience.getCounter("acc-b", "browser", old)).toBe(0);
    expect(await audience.getCounter("acc-a", "reply", edge)).toBe(1);
    expect(await audience.getCounter("acc-a", "reply", today)).toBe(5);
    expect(await audience.getCounter("acc-b", "browser", today)).toBe(9);
    expect(await audience.getCounter("acc-a", "outreach:seq", `${today}T11`)).toBe(3);
    expect(await audience.getCounter("outreach", "outreach-stat:seq:sent", "total")).toBe(12);
  });

  it("leaves unknown key shapes alone and is a no-op on repeat or an invalid clock", async () => {
    const { audience } = await fixture();
    await audience.incrementCounter("acc-a", "reply", "lifetime", 2);
    await audience.incrementCounter("acc-a", "reply", "1999", 2);
    await audience.incrementCounter("acc-a", "reply", dayOf(-30), 1);

    expect(await audience.pruneSpentCounters(Number.NaN)).toBe(0);
    expect(await audience.pruneSpentCounters(NOW, 0)).toBe(0);
    expect(await audience.pruneSpentCounters(NOW)).toBe(1);
    expect(await audience.pruneSpentCounters(NOW)).toBe(0);

    expect(await audience.getCounter("acc-a", "reply", "lifetime")).toBe(2);
    expect(await audience.getCounter("acc-a", "reply", "1999")).toBe(2);
  });

  it("deletes at most one bounded batch per pass and finishes the backlog on the next", async () => {
    const { audience } = await fixture();
    const old = dayOf(-30);
    for (let index = 0; index < 5; index++)
      await audience.incrementCounter(`acc-${index}`, "reply", old);

    expect(await audience.pruneSpentCounters(NOW, 3)).toBe(3);
    expect(await audience.pruneSpentCounters(NOW, 3)).toBe(2);
    expect(await audience.pruneSpentCounters(NOW, 3)).toBe(0);
    expect(SPENT_COUNTER_PRUNE_BATCH).toBeGreaterThan(0);
  });

  it("throttles the tick entry so a second call inside the interval does not prune", async () => {
    const { audience } = await fixture();
    await audience.incrementCounter("acc-a", "reply", dayOf(-30));
    await audience.pruneSpentCountersIfDue(NOW);
    await audience.incrementCounter("acc-a", "reply", dayOf(-31));
    await audience.pruneSpentCountersIfDue(NOW);

    expect(await audience.getCounter("acc-a", "reply", dayOf(-30))).toBe(0);
    expect(await audience.getCounter("acc-a", "reply", dayOf(-31))).toBe(1);
  });
});
