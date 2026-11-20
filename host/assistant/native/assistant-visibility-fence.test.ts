import { describe, expect, it } from "vitest";
import { AssistantVisibilityFence } from "./assistant-visibility-fence";

const source = { issuer: "window-issuer", environmentId: "host", threadId: "room" };
const target = { projectId: "project", cwd: "/project" };

describe("Room visibility admission", () => {
  it("closes admission before revoke acknowledgement and drains accepted effects", async () => {
    const fence = new AssistantVisibilityFence();
    fence.reopen(fence.currentEpoch());
    fence.register(source, 1, [target], fence.currentEpoch());
    const permit = fence.acquire(source, target);
    let acknowledged = false;
    const revoked = fence.revoke(source, 2).then(() => {
      acknowledged = true;
    });
    expect(permit.valid()).toBe(false);
    expect(() => fence.acquire(source, target)).toThrow();
    expect(() => fence.register(source, 3, [target], fence.currentEpoch())).toThrow();
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    permit.release();
    permit.release();
    await revoked;
    expect(acknowledged).toBe(true);
    expect(() => fence.register(source, 1, [target], fence.currentEpoch())).toThrow();
    fence.register(source, 3, [target], fence.currentEpoch());
    expect(fence.acquire(source, target).valid()).toBe(true);
  });

  it("binds issuer, Host, thread, project and exact cwd and rejects late registration", async () => {
    const fence = new AssistantVisibilityFence();
    await fence.revoke(source, 4);
    fence.reopen(fence.currentEpoch());
    expect(() => fence.register(source, 3, [target], fence.currentEpoch())).toThrow();
    fence.register(source, 5, [target], fence.currentEpoch());
    for (const other of [
      { ...source, issuer: "replacement" },
      { ...source, environmentId: "other-host" },
      { ...source, threadId: "other-room" },
    ])
      expect(() => fence.acquire(other, target)).toThrow();
    expect(() => fence.acquire(source, { ...target, projectId: "other" })).toThrow();
    expect(() => fence.acquire(source, { ...target, cwd: "/other" })).toThrow();
  });

  it("invalidates every source and refuses snapshots captured before a privacy change", async () => {
    const fence = new AssistantVisibilityFence();
    fence.reopen(fence.currentEpoch());
    const other = { ...source, threadId: "other" };
    const epoch = fence.currentEpoch();
    fence.register(source, 1, [target], epoch);
    fence.register(other, 1, [target], epoch);
    const permit = fence.acquire(other, target);
    const drained = fence.revokeAll();
    expect(() => fence.acquire(source, target)).toThrow();
    expect(() => fence.register(source, 2, [target], epoch)).toThrow();
    expect(() => fence.register(source, 2, [target], fence.currentEpoch())).toThrow();
    expect(() => fence.reopen(fence.currentEpoch())).toThrow();
    expect(permit.valid()).toBe(false);
    permit.release();
    await drained;
    fence.reopen(fence.currentEpoch());
    fence.register(source, 2, [target], fence.currentEpoch());
  });
});

describe("Room visibility capacity", () => {
  const room = (index: number) => ({ ...source, threadId: `room-${index}` });
  function fill(fence: AssistantVisibilityFence, register: (index: number) => void) {
    fence.reopen(fence.currentEpoch());
    for (let index = 0; index < 1024; index++) register(index);
  }

  it("retires drained entries from a closed epoch instead of refusing new sources", async () => {
    const fence = new AssistantVisibilityFence();
    fill(fence, (index) => fence.register(room(index), 1, [target], fence.currentEpoch()));
    expect(() => fence.register(room(1024), 1, [target], fence.currentEpoch())).toThrow(
      "Room visibility capacity reached",
    );
    const staleEpoch = fence.currentEpoch();
    await fence.revokeAll();
    fence.reopen(fence.currentEpoch());
    expect(() => fence.register(room(1024), 1, [target], staleEpoch)).toThrow();
    fence.register(room(1024), 1, [target], fence.currentEpoch());
    expect(fence.acquire(room(1024), target).valid()).toBe(true);
    expect(() => fence.acquire(room(0), target)).toThrow();
    expect(() => fence.acquireSource(room(0))).toThrow();
  });

  it("keeps entries revoked in the current epoch, with their sequence floor, and fails closed", () => {
    const fence = new AssistantVisibilityFence();
    fill(fence, (index) => void fence.revoke(room(index), 5));
    expect(() => fence.revoke(room(1024), 1)).toThrow("Room visibility capacity reached");
    expect(() => fence.register(room(1024), 1, [target], fence.currentEpoch())).toThrow(
      "Room visibility capacity reached",
    );
    expect(() => fence.register(room(0), 4, [target], fence.currentEpoch())).toThrow();
    expect(() => fence.acquire(room(0), target)).toThrow();
  });

  it("keeps an old-epoch entry that was revoked again in the current epoch", async () => {
    const fence = new AssistantVisibilityFence();
    fill(fence, (index) => fence.register(room(index), 1, [target], fence.currentEpoch()));
    await fence.revokeAll();
    fence.reopen(fence.currentEpoch());
    await fence.revoke(room(0), 10);
    fence.register(room(1024), 1, [target], fence.currentEpoch());
    expect(() => fence.register(room(0), 9, [target], fence.currentEpoch())).toThrow();
    fence.register(room(0), 11, [target], fence.currentEpoch());
    expect(fence.acquire(room(0), target).valid()).toBe(true);
  });

  it("never retires an entry that still has a permit or a waiter", async () => {
    const fence = new AssistantVisibilityFence();
    fill(fence, (index) => fence.register(room(index), 1, [target], fence.currentEpoch()));
    const permit = fence.acquire(room(0), target);
    const drained = fence.revokeAll();
    expect(() => fence.reopen(fence.currentEpoch())).toThrow();
    expect(() => fence.register(room(1024), 1, [target], fence.currentEpoch())).toThrow();
    permit.release();
    await drained;
    fence.reopen(fence.currentEpoch());
    fence.register(room(1024), 1, [target], fence.currentEpoch());
    expect(permit.valid()).toBe(false);
  });
});
