import { describe, expect, it, vi } from "vitest";
import { DesktopDelete } from "./desktopDelete";

describe("desktop deletion delivery", () => {
  it("requires a capable desktop and scopes confirmations to its client", async () => {
    const bridge = new DesktopDelete();
    await expect(bridge.request("s", "/project", () => true)).rejects.toThrow(/Open the updated/);
    bridge.beat("owner", { version: 1 });
    const deleted = bridge.request("s", "/project", () => true);
    const job = bridge.beat("owner", { version: 1 }).jobs[0];
    expect(bridge.beat("owner", { version: 1 }).jobs).toEqual([]);
    expect(bridge.beat("other", { version: 1, replies: [{ id: job.id }] }).acked).toEqual([]);
    bridge.beat("owner", {
      version: 1,
      replies: [{ id: job.id, error: "busy" }],
    });
    await expect(deleted).rejects.toThrow("busy");
  });

  it("does not dispatch after device authorization is revoked", async () => {
    const bridge = new DesktopDelete();
    bridge.beat("owner", { version: 1 });
    const deleted = bridge.request("s", "/project", () => false);
    expect(bridge.beat("owner", { version: 1 }).jobs).toEqual([]);
    await expect(deleted).rejects.toThrow(/revoked/);
  });

  it("reports an unconfirmed deletion without replaying it", async () => {
    vi.useFakeTimers();
    try {
      const bridge = new DesktopDelete();
      bridge.beat("owner", { version: 1 });
      const deleted = bridge.request("s", "/project", () => true);
      const rejected = expect(deleted).rejects.toThrow(/did not confirm/);
      bridge.beat("owner", { version: 1 });
      await vi.advanceTimersByTimeAsync(18_000);
      await rejected;
      expect(bridge.beat("owner", { version: 1 }).jobs).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
