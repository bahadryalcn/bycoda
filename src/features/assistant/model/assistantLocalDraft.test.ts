// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalDraftWriter } from "./assistantLocalDraft";

const key = "bycoda.assistant.test-draft";

describe("createLocalDraftWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("does not touch storage per change and writes the latest value after the quiet period", () => {
    const writer = createLocalDraftWriter(key);
    const serialize = vi.fn(() => "latest");
    writer.schedule(() => "first");
    writer.schedule(serialize);
    expect(localStorage.getItem(key)).toBeNull();
    vi.advanceTimersByTime(399);
    expect(localStorage.getItem(key)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(localStorage.getItem(key)).toBe("latest");
    expect(serialize).toHaveBeenCalledTimes(1);
  });

  it("bounds continuous typing to the maximum wait", () => {
    const writer = createLocalDraftWriter(key);
    let text = "";
    for (let i = 0; i < 10; i++) {
      text += "a";
      const value = text;
      writer.schedule(() => value);
      vi.advanceTimersByTime(300);
    }
    // 3000 ms of typing with no quiet gap: the 2000 ms maximum must have written.
    expect(localStorage.getItem(key)).toBe(text.slice(0, 7));
  });

  it("flush writes now and keeps a failed draft pending for a later retry", () => {
    const statuses: boolean[] = [];
    const writer = createLocalDraftWriter(key, (saved) => statuses.push(saved));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("quota");
    });
    writer.schedule(() => "kept");
    expect(writer.flush()).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
    expect(writer.flush()).toBe(true);
    expect(localStorage.getItem(key)).toBe("kept");
    expect(statuses).toEqual([false, true]);
    setItem.mockRestore();
  });

  it("cancel drops the pending write without storing it", () => {
    const writer = createLocalDraftWriter(key);
    writer.schedule(() => "stale");
    writer.cancel();
    vi.advanceTimersByTime(5000);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("clear removes the stored draft and prevents a pending write from restoring it", () => {
    const writer = createLocalDraftWriter(key);
    writer.schedule(() => "saved");
    expect(writer.flush()).toBe(true);
    writer.schedule(() => "unsent");
    writer.clear();
    vi.advanceTimersByTime(5000);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("flushes on pagehide until detached", () => {
    const writer = createLocalDraftWriter(key);
    const detach = writer.attach();
    writer.schedule(() => "on-hide");
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(key)).toBe("on-hide");
    detach();
    writer.schedule(() => "after-detach");
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(key)).toBe("on-hide");
  });
});
