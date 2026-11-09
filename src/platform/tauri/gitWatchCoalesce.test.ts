import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitWatchCoalescer, sameCheckout } from "./gitWatchCoalesce";

describe("createGitWatchCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers one notification for a burst of reports on one checkout", () => {
    const notify = vi.fn();
    const coalescer = createGitWatchCoalescer(notify);

    for (let i = 0; i < 20; i += 1) {
      coalescer.push([{ cwd: "C:/repo", index: true, refs: false }]);
      vi.advanceTimersByTime(10);
    }
    expect(notify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("C:/repo", "index");
  });

  it("widens the merged scope to the checkout when any report touched refs", () => {
    const notify = vi.fn();
    const coalescer = createGitWatchCoalescer(notify);

    coalescer.push([{ cwd: "C:/repo", index: true, refs: false }]);
    coalescer.push([{ cwd: "C:/repo", index: false, refs: true }]);
    coalescer.push([{ cwd: "C:/repo", index: true, refs: false }]);
    vi.advanceTimersByTime(250);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("C:/repo", "checkout");
  });

  it("delivers one notification per repository", () => {
    const notify = vi.fn();
    const coalescer = createGitWatchCoalescer(notify);

    coalescer.push([
      { cwd: "C:/one", index: true, refs: false },
      { cwd: "C:/two", index: false, refs: true },
      { cwd: "C:/one", index: true, refs: false },
      { cwd: "C:/two", index: true, refs: false },
    ]);
    vi.advanceTimersByTime(250);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("C:/one", "index");
    expect(notify).toHaveBeenCalledWith("C:/two", "checkout");
  });

  it("keeps delivering during a continuous report stream through the max wait", () => {
    const notify = vi.fn();
    const coalescer = createGitWatchCoalescer(notify);

    // A report every 100 ms never leaves a 250 ms quiet period.
    for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
      coalescer.push([{ cwd: "C:/repo", index: true, refs: false }]);
      vi.advanceTimersByTime(100);
    }
    expect(notify).toHaveBeenCalledTimes(1);

    // The next report starts a new quiet period.
    coalescer.push([{ cwd: "C:/repo", index: true, refs: false }]);
    vi.advanceTimersByTime(250);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("drops the undelivered report of a checkout that is cancelled", () => {
    const notify = vi.fn();
    const coalescer = createGitWatchCoalescer(notify);

    coalescer.push([{ cwd: "C:/repo", index: true, refs: true }]);
    coalescer.cancel("C:\\repo\\");
    vi.advanceTimersByTime(2000);

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("sameCheckout", () => {
  it("matches the same folder and nested folders, ignoring case and separators", () => {
    expect(sameCheckout("C:\\Repo", "c:/repo/")).toBe(true);
    expect(sameCheckout("C:/repo/packages/a", "C:/repo")).toBe(true);
    expect(sameCheckout("C:/repo-other", "C:/repo")).toBe(false);
  });
});
