import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelQueuedSessionSyncs,
  COLD_SYNCS_PER_MACHINE,
  resetSessionSyncGatesForTests,
  runSessionSync,
  setFocusedSyncSessions,
} from "./coldSyncGate";

type Deferred = { id: string; resolve: () => void; reject: (error: Error) => void };

function harness() {
  const started: string[] = [];
  const open = new Map<string, Deferred>();
  let peak = 0;
  const sync = (machine: string, id: string, revision: number | undefined) =>
    runSessionSync(machine, id, revision, () => {
      started.push(id);
      peak = Math.max(peak, open.size + 1);
      return new Promise<void>((resolve, reject) => {
        open.set(id, {
          id,
          resolve: () => {
            open.delete(id);
            resolve();
          },
          reject: (error) => {
            open.delete(id);
            reject(error);
          },
        });
      });
    });
  return { started, open, sync, peak: () => peak };
}

describe("cold sync gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetSessionSyncGatesForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never runs more than the budget of cold syncs after a 20-session reset", async () => {
    const h = harness();
    const all = Array.from({ length: 20 }, (_, i) => h.sync("m", `s${i}`, 0));
    expect(h.open.size).toBe(COLD_SYNCS_PER_MACHINE);
    while (h.open.size) {
      h.open.values().next().value!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.open.size).toBeLessThanOrEqual(COLD_SYNCS_PER_MACHINE);
    }
    await Promise.all(all);
    expect(h.started).toHaveLength(20);
    expect(h.peak()).toBe(COLD_SYNCS_PER_MACHINE);
  });

  it("sends the focused session first, without queueing", async () => {
    const h = harness();
    setFocusedSyncSessions("m", ["focus"]);
    for (let i = 0; i < 5; i += 1) void h.sync("m", `s${i}`, undefined);
    void h.sync("m", "focus", 0);
    // The budget is full; the focused session still starts at once.
    expect(h.started).toEqual(["s0", "s1", "s2", "focus"]);
  });

  it("does not queue warm syncs behind cold ones", async () => {
    const h = harness();
    for (let i = 0; i < 6; i += 1) void h.sync("m", `s${i}`, 0);
    await vi.advanceTimersByTimeAsync(300);
    void h.sync("m", "warm", 42);
    expect(h.started).toContain("warm");
    expect(h.open.size).toBe(COLD_SYNCS_PER_MACHINE + 1);
  });

  it("frees the slot of a rejected sync", async () => {
    const h = harness();
    const first = Array.from({ length: 4 }, (_, i) => h.sync("m", `s${i}`, 0));
    first.forEach((p) => p.catch(() => {}));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.started).toEqual(["s0", "s1", "s2"]);
    h.open.get("s0")!.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.started).toContain("s3");
    await expect(first[0]).rejects.toThrow("boom");
  });

  it("releases queued syncs when the channel closes", async () => {
    const h = harness();
    const all = Array.from({ length: 6 }, (_, i) => h.sync("m", `s${i}`, 0));
    all.forEach((p) => p.catch(() => {}));
    await vi.advanceTimersByTimeAsync(300);
    cancelQueuedSessionSyncs("m");
    await expect(all[5]).rejects.toThrow("cancelled");
    for (const entry of h.open.values()) entry.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.started).toHaveLength(COLD_SYNCS_PER_MACHINE);
    // A later wave starts clean.
    void h.sync("m", "again", 0);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.started).toContain("again");
  });

  it("budgets each machine separately", async () => {
    const h = harness();
    for (let i = 0; i < 4; i += 1) void h.sync("a", `a${i}`, 0);
    for (let i = 0; i < 4; i += 1) void h.sync("b", `b${i}`, 0);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.open.size).toBe(COLD_SYNCS_PER_MACHINE * 2);
  });
});
