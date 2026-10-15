import { expect, it, vi } from "vitest";
import { RevisionWaits } from "./revisionWait";

it("releases a pending read as soon as its revision changes", async () => {
  vi.useFakeTimers();
  try {
    let revision = 1;
    const waits = new RevisionWaits();
    let complete = false;
    const pending = waits
      .wait(() => revision, 1, 10_000)
      .then(() => {
        complete = true;
      });
    await vi.advanceTimersByTimeAsync(100);
    expect(complete).toBe(false);
    // Command dispatch is independent of waiting readers.
    revision = 2;
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(complete).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("caps waiters and releases capacity after disconnected requests", async () => {
  vi.useFakeTimers();
  try {
    const waits = new RevisionWaits(1);
    let cancelled = false;
    const first = waits.wait(
      () => 1,
      1,
      10_000,
      () => cancelled,
    );
    await waits.wait(() => 1, 1, 10_000);
    expect(vi.getTimerCount()).toBe(1);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(100);
    await first;
    const next = waits.wait(() => 1, 1, 100);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await next;
  } finally {
    vi.useRealTimers();
  }
});
