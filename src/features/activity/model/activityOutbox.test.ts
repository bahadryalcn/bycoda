import { describe, expect, it } from "vitest";
import { countMinutes, decodeMinutes } from "@bycoda/account-contracts/activity";
import { saveOutbox, takeOutbox, type StorageLike } from "./activityOutbox";
import { ActivityTracker, TICK_MS } from "./activityTracker";

const T0 = Date.UTC(2026, 10, 8, 9, 0, 0);

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function reportsFor(minutes: number, start = T0) {
  const tracker = new ActivityTracker();
  tracker.noteInput(start);
  for (let at = start; at <= start + minutes * 60_000; at += TICK_MS)
    tracker.tick({ wall: at, mono: at }, { foreground: true }, "Europe/Istanbul");
  return tracker.drain();
}
const count = (reports: ReturnType<typeof reportsFor>) =>
  reports.reduce((sum, r) => sum + countMinutes(decodeMinutes(r.minutes)), 0);

describe("activity outbox", () => {
  it("returns saved reports once, only for the Host they belong to", () => {
    const storage = memoryStorage();
    saveOutbox("pc", reportsFor(2), storage);
    saveOutbox("laptop", reportsFor(1), storage);
    expect(takeOutbox("other", storage)).toEqual([]);
    expect(count(takeOutbox("pc", storage))).toBe(3);
    expect(takeOutbox("pc", storage)).toEqual([]);
    expect(count(takeOutbox("laptop", storage))).toBe(2);
    expect(storage.data.size).toBe(0);
  });

  it("merges repeated saves by OR so a minute counts once", () => {
    const storage = memoryStorage();
    saveOutbox("pc", reportsFor(2), storage);
    saveOutbox("pc", reportsFor(2), storage);
    saveOutbox("pc", reportsFor(1, T0 + 10 * 60_000), storage);
    expect(count(takeOutbox("pc", storage))).toBe(5);
  });

  it("ignores corrupt or unavailable storage", () => {
    const storage = memoryStorage();
    storage.data.set("bycoda.activity.outbox.v1", "{not json");
    expect(takeOutbox("pc", storage)).toEqual([]);
    storage.data.set(
      "bycoda.activity.outbox.v1",
      JSON.stringify({ pc: [{ date: "x", timeZone: "UTC", minutes: "short" }] }),
    );
    expect(takeOutbox("pc", storage)).toEqual([]);
    expect(() => saveOutbox("pc", reportsFor(1), null)).not.toThrow();
    expect(takeOutbox("pc", null)).toEqual([]);
  });

  it("keeps only the newest days per Host", () => {
    const storage = memoryStorage();
    const day = 24 * 60 * 60_000;
    for (let i = 0; i < 20; i++) saveOutbox("pc", reportsFor(0, T0 + i * day), storage);
    const kept = takeOutbox("pc", storage);
    expect(kept).toHaveLength(14);
    expect(kept.at(-1)!.date).toBe("2026-11-27");
  });
});
