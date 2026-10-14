import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ProviderInboxBridge } from "./provider-inbox";
import type { RemoteInboxOperation } from "../src/features/inbox/model/remoteInbox";

const databases: DatabaseSync[] = [];
const read: RemoteInboxOperation = { action: "providers" };
const write: RemoteInboxOperation = {
  action: "comment",
  item: {
    provider: "github",
    kind: "issue",
    number: 1,
    repo: "owner/repo",
    projectPath: "/project",
  },
  cwd: "/project",
  body: "A comment",
};
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  let time = 100_000;
  const bridge = new ProviderInboxBridge(db, () => time);
  return {
    db,
    bridge,
    advance: (ms: number) => {
      time += ms;
    },
    now: () => time,
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("desktop provider inbox job bridge", () => {
  it("reports unavailable instead of inventing an empty inbox when desktop is absent", () => {
    const { bridge } = setup();
    expect(bridge.availability()).toMatchObject({ available: false });
    expect(() => bridge.request("client", "read-1", read)).toThrow("Open the updated");
    bridge.beat("native", "desktop", { version: 1 });
    expect(bridge.availability()).toEqual({ available: true });
  });

  it("deduplicates device request IDs and rejects a changed payload under the same ID", () => {
    const { bridge } = setup();
    bridge.beat("native", "desktop", { version: 1 });
    const receipt = bridge.request("client", "request-1", read);
    expect(bridge.request("client", "request-1", read)).toEqual(receipt);
    expect(() => bridge.request("client", "request-1", write)).toThrow("another operation");
    expect(() => bridge.result("other-client", "request-1")).toThrow("not found");
  });

  it("claims each job to one desktop client and accepts results only from that client", () => {
    const { bridge } = setup();
    bridge.beat("native", "window-a", { version: 1 });
    const receipt = bridge.request("client", "request-1", read);
    expect(bridge.beat("native", "window-a", { version: 1 }).jobs.map((job) => job.id)).toEqual([
      receipt.id,
    ]);
    expect(
      bridge.beat("native", "window-b", {
        version: 1,
        replies: [{ id: receipt.id, result: ["forged"] }],
      }),
    ).toEqual({ jobs: [], acked: [] });
    expect(bridge.result("client", "request-1").state).toBe("running");
    expect(
      bridge.beat("native", "window-a", {
        version: 1,
        replies: [{ id: receipt.id, result: ["real"] }],
      }).acked,
    ).toEqual([receipt.id]);
    expect(bridge.result("client", "request-1")).toMatchObject({
      state: "completed",
      result: ["real"],
    });
  });

  it("does not overload a native client with more than two simultaneous provider jobs", () => {
    const { bridge } = setup();
    bridge.beat("native", "desktop", { version: 1 });
    for (let index = 0; index < 5; index++) bridge.request("client", `read-${index}`, read);
    expect(bridge.beat("native", "desktop", { version: 1 }).jobs).toHaveLength(2);
    expect(bridge.beat("native", "desktop", { version: 1 }).jobs).toHaveLength(0);
  });

  it("marks a dispatched send uncertain after disconnect and never reclaims it", () => {
    const { bridge, advance } = setup();
    bridge.beat("native", "desktop", { version: 1 });
    const receipt = bridge.request("client", "send-1", write);
    bridge.beat("native", "desktop", { version: 1 });
    advance(21_000);
    expect(bridge.result("client", "send-1").state).toBe("uncertain");
    expect(bridge.beat("native", "desktop", { version: 1 }).jobs).toHaveLength(0);
    expect(bridge.request("client", "send-1", write)).toMatchObject({
      id: receipt.id,
      state: "uncertain",
    });
  });

  it("preserves uncertain write receipts across host restart without replay", () => {
    const { bridge, db, now } = setup();
    bridge.beat("native", "desktop", { version: 1 });
    bridge.request("client", "send-1", write);
    bridge.beat("native", "desktop", { version: 1 });
    const restarted = new ProviderInboxBridge(db, now);
    expect(restarted.result("client", "send-1").state).toBe("uncertain");
    expect(restarted.beat("native", "desktop", { version: 1 }).jobs).toHaveLength(0);
  });

  it("expires an unstarted send rather than publishing later when the desktop returns", () => {
    const { bridge, advance } = setup();
    bridge.beat("native", "desktop", { version: 1 });
    bridge.request("client", "send-1", write);
    advance(61_000);
    expect(bridge.beat("native", "desktop", { version: 1 }).jobs).toHaveLength(0);
    expect(bridge.result("client", "send-1").state).toBe("failed");
  });

  it("redacts native authentication errors and treats rejected sends conservatively", () => {
    const { bridge } = setup();
    bridge.beat("native", "desktop", { version: 1 });
    const receipt = bridge.request("client", "send-1", write);
    bridge.beat("native", "desktop", { version: 1 });
    bridge.beat("native", "desktop", {
      version: 1,
      replies: [
        {
          id: receipt.id,
          error: "Bearer private-key token=private-key https://host?access_token=private-key",
        },
      ],
    });
    const result = bridge.result("client", "send-1");
    expect(result.state).toBe("uncertain");
    expect(result.error).not.toContain("private-key");
  });
});
