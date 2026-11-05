import { describe, expect, it, vi } from "vitest";
import { DesktopStatusChanges } from "./desktop-status-changes";

describe("desktop status invalidation", () => {
  it("wakes exact owner instance and retains revision across missed events", async () => {
    const owner = new DesktopStatusChanges();
    const other = new DesktopStatusChanges();
    const wait = owner.wait(owner.current(), 30_000);
    const before = owner.current();
    owner.changed();
    expect(await wait).toBe(owner.current());
    expect(await owner.wait(before, 30_000)).toBe(owner.current());
    expect(other.current()).not.toBe(owner.current());
  });
  it("reconciles after a bounded idle wait", async () => {
    vi.useFakeTimers();
    try {
      const owner = new DesktopStatusChanges();
      const initial = owner.current();
      const wait = owner.wait(initial, 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await wait).toBe(initial);
    } finally { vi.useRealTimers(); }
  });
});
  it("ends a detached wait and preserves later revisions", async () => {
    const owner = new DesktopStatusChanges();
    const initial = owner.current();
    const abort = new AbortController();
    const wait = owner.wait(initial, 25_000, abort.signal);
    abort.abort();
    expect(await wait).toBe(initial);
    owner.changed();
    expect(await owner.wait(initial, 25_000)).toBe(owner.current());
  });
