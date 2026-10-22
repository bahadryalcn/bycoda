// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
let seen: typeof import("./linkedSessionSeen");

describe("linked session seen snapshots", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    seen = await import("./linkedSessionSeen");
  });

  it("remembers the newest acknowledged remote update per session", () => {
    const { linkedSessionSeenAt, markLinkedSessionUpdateSeen } = seen;
    markLinkedSessionUpdateSeen("session-1", 200);
    markLinkedSessionUpdateSeen("session-1", 150);
    markLinkedSessionUpdateSeen("session-2", 300);

    expect(linkedSessionSeenAt("session-1")).toBe(200);
    expect(linkedSessionSeenAt("session-2")).toBe(300);
  });

  it("notifies subscribers after retaining failed-storage acknowledgements and later flushes them", () => {
    const { linkedSessionSeenAt, markLinkedSessionUpdateSeen, subscribeLinkedSessionSeen } = seen;
    markLinkedSessionUpdateSeen("stored", 100);
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const observed: number[] = [];
    const stop = subscribeLinkedSessionSeen(() => observed.push(linkedSessionSeenAt("volatile")));
    try {
      markLinkedSessionUpdateSeen("volatile", 200);
      markLinkedSessionUpdateSeen("volatile", 150);
      expect(observed).toEqual([200, 200]);
      expect(linkedSessionSeenAt("stored")).toBe(100);
      expect(linkedSessionSeenAt("volatile")).toBe(200);
    } finally {
      write.mockRestore();
      stop();
    }
    // Another window may have advanced durable state while storage failed here.
    localStorage.setItem("bycoda.linkedSessionSeen", JSON.stringify({ stored: 300 }));
    markLinkedSessionUpdateSeen("next", 400);
    expect(JSON.parse(localStorage.getItem("bycoda.linkedSessionSeen")!)).toEqual({
      next: 400,
      stored: 300,
      volatile: 200,
    });
  });
});
