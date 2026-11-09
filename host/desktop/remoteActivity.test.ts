import { describe, expect, it } from "vitest";
import { RemoteActivityFeed, requestingDeviceName } from "./remoteActivity";

describe("remote activity feed", () => {
  it("never replays old events to a desktop that has not read the feed", () => {
    const feed = new RemoteActivityFeed();
    feed.record({ kind: "archived", cwd: "/p", requestedBy: "Laptop" });
    expect(feed.since(undefined)).toEqual({ seq: 1, events: [], reset: true });
    feed.record({ kind: "worktreeChanged", cwd: "/p", requestedBy: "  Phone  " });
    expect(feed.since(1)).toEqual({
      seq: 2,
      events: [{ kind: "worktreeChanged", cwd: "/p", requestedBy: "Phone" }],
    });
    expect(feed.since(2)).toEqual({ seq: 2, events: [] });
  });

  it("resets a position it no longer keeps or never issued", () => {
    const feed = new RemoteActivityFeed();
    for (let index = 0; index < 205; index += 1) feed.record({ kind: "archived", cwd: "/p" });
    expect(feed.since(1)).toEqual({ seq: 205, events: [], reset: true });
    expect(feed.since(999)).toEqual({ seq: 205, events: [], reset: true });
    expect(feed.since(200).events).toHaveLength(5);
  });

  it("names the requesting device, or nothing when the lookup fails", async () => {
    const devices = [
      { name: "Desk", isCurrent: false },
      { name: "Laptop", isCurrent: true },
    ];
    expect(await requestingDeviceName({ pairedDevices: async () => ({ devices }) }, "t")).toBe(
      "Laptop",
    );
    expect(
      await requestingDeviceName(
        {
          pairedDevices: async () => {
            throw new Error("revoked");
          },
        },
        "t",
      ),
    ).toBeUndefined();
  });
});
