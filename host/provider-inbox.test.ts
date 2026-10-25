import { afterEach, describe, expect, it } from "vitest";
import { StoreDatabase } from "./store-db";
import { ProviderInboxBridge } from "./provider-inbox";
import type { RemoteInboxOperation } from "../src/features/inbox/model/remoteInbox";
const databases: StoreDatabase[] = [];
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
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  let time = 100000;
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
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});
describe("desktop provider inbox job bridge", () => {
  it.each([21000, 121000])(
    "stores same-client late success after %i ms before acknowledging",
    async (elapsed) => {
      const { bridge, advance } = setup();
      await bridge.beat("native", "desktop", { version: 1 });
      const receipt = await bridge.request("client", "review-late", write);
      await bridge.beat("native", "desktop", { version: 1 });
      advance(elapsed);
      expect((await bridge.result("client", "review-late")).state).toBe("uncertain");
      const result = { url: "https://example.invalid/review/1" };
      expect(
        (
          await bridge.beat("other-owner", "desktop", {
            version: 1,
            replies: [{ id: receipt.id, result }],
          })
        ).acked,
      ).toEqual([]);
      expect(
        (
          await bridge.beat("native", "other-desktop", {
            version: 1,
            replies: [{ id: receipt.id, result }],
          })
        ).acked,
      ).toEqual([]);
      const reply = { version: 1, replies: [{ id: receipt.id, result }] };
      expect(await bridge.beat("native", "desktop", reply)).toEqual({
        jobs: [],
        acked: [receipt.id],
      });
      expect(await bridge.result("client", "review-late")).toEqual({
        id: receipt.id,
        state: "completed",
        result,
      });
      expect(
        (
          await bridge.beat("native", "desktop", {
            version: 1,
            replies: [{ id: receipt.id, result: "duplicate cannot replace result" }],
          })
        ).acked,
      ).toEqual([receipt.id]);
      expect((await bridge.result("client", "review-late")).result).toEqual(result);
    },
  );
  it("retains a successful write reply after host restart without redispatch", async () => {
    const { bridge, db, now } = setup();
    await bridge.beat("native", "desktop", { version: 1 });
    const receipt = await bridge.request("client", "review-restart", write);
    await bridge.beat("native", "desktop", { version: 1 });
    const restarted = new ProviderInboxBridge(db, now);
    expect(
      await restarted.beat("native", "desktop", {
        version: 1,
        replies: [{ id: receipt.id, result: { url: "https://example.invalid/review/2" } }],
      }),
    ).toEqual({ jobs: [], acked: [receipt.id] });
    expect(await restarted.result("client", "review-restart")).toMatchObject({
      state: "completed",
      result: { url: "https://example.invalid/review/2" },
    });
  });
  it("reports unavailable instead of inventing an empty inbox when desktop is absent", async () => {
    const { bridge } = setup();
    expect(await bridge.availability()).toMatchObject({ available: false });
    await expect((async () => await bridge.request("client", "read-1", read))()).rejects.toThrow(
      "Open the updated",
    );
    await bridge.beat("native", "desktop", { version: 1 });
    expect(await bridge.availability()).toEqual({ available: true });
  });
  it("deduplicates device request IDs and rejects a changed payload under the same ID", async () => {
    const { bridge } = setup();
    await bridge.beat("native", "desktop", { version: 1 });
    const receipt = await bridge.request("client", "request-1", read);
    expect(await bridge.request("client", "request-1", read)).toEqual(receipt);
    await expect(
      (async () => await bridge.request("client", "request-1", write))(),
    ).rejects.toThrow("another operation");
    await expect((async () => await bridge.result("other-client", "request-1"))()).rejects.toThrow(
      "not found",
    );
  });
  it("claims each job to one desktop client and accepts results only from that client", async () => {
    const { bridge } = setup();
    await bridge.beat("native", "window-a", { version: 1 });
    const receipt = await bridge.request("client", "request-1", read);
    expect(
      (await bridge.beat("native", "window-a", { version: 1 })).jobs.map((job) => job.id),
    ).toEqual([receipt.id]);
    expect(
      await bridge.beat("native", "window-b", {
        version: 1,
        replies: [{ id: receipt.id, result: ["forged"] }],
      }),
    ).toEqual({ jobs: [], acked: [] });
    expect((await bridge.result("client", "request-1")).state).toBe("running");
    expect(
      (
        await bridge.beat("native", "window-a", {
          version: 1,
          replies: [{ id: receipt.id, result: ["real"] }],
        })
      ).acked,
    ).toEqual([receipt.id]);
    expect(await bridge.result("client", "request-1")).toMatchObject({
      state: "completed",
      result: ["real"],
    });
  });
  it("does not overload a native client with more than two simultaneous provider jobs", async () => {
    const { bridge } = setup();
    await bridge.beat("native", "desktop", { version: 1 });
    for (let index = 0; index < 5; index++) await bridge.request("client", `read-${index}`, read);
    expect((await bridge.beat("native", "desktop", { version: 1 })).jobs).toHaveLength(2);
    expect((await bridge.beat("native", "desktop", { version: 1 })).jobs).toHaveLength(0);
  });
  it("marks a dispatched send uncertain after disconnect and never reclaims it", async () => {
    const { bridge, advance } = setup();
    await bridge.beat("native", "desktop", { version: 1 });
    const receipt = await bridge.request("client", "send-1", write);
    await bridge.beat("native", "desktop", { version: 1 });
    advance(21000);
    expect((await bridge.result("client", "send-1")).state).toBe("uncertain");
    expect((await bridge.beat("native", "desktop", { version: 1 })).jobs).toHaveLength(0);
    expect(await bridge.request("client", "send-1", write)).toMatchObject({
      id: receipt.id,
      state: "uncertain",
    });
  });
  it("preserves uncertain write receipts across host restart without replay", async () => {
    const { bridge, db, now } = setup();
    await bridge.beat("native", "desktop", { version: 1 });
    await bridge.request("client", "send-1", write);
    await bridge.beat("native", "desktop", { version: 1 });
    const restarted = new ProviderInboxBridge(db, now);
    expect((await restarted.result("client", "send-1")).state).toBe("uncertain");
    expect((await restarted.beat("native", "desktop", { version: 1 })).jobs).toHaveLength(0);
  });
  it("expires an unstarted send rather than publishing later when the desktop returns", async () => {
    const { bridge, advance } = setup();
    await bridge.beat("native", "desktop", { version: 1 });
    await bridge.request("client", "send-1", write);
    advance(61000);
    expect((await bridge.beat("native", "desktop", { version: 1 })).jobs).toHaveLength(0);
    expect((await bridge.result("client", "send-1")).state).toBe("failed");
  });
  it("redacts native authentication errors and treats rejected sends conservatively", async () => {
    const { bridge } = setup();
    await bridge.beat("native", "desktop", { version: 1 });
    const receipt = await bridge.request("client", "send-1", write);
    await bridge.beat("native", "desktop", { version: 1 });
    await bridge.beat("native", "desktop", {
      version: 1,
      replies: [
        {
          id: receipt.id,
          error: "Bearer private-key token=private-key https://host?access_token=private-key",
        },
      ],
    });
    const result = await bridge.result("client", "send-1");
    expect(result.state).toBe("uncertain");
    expect(result.error).not.toContain("private-key");
  });
});
