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
    const revoked = fence.revoke(source, 2).then(() => { acknowledged = true; });
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
    ]) expect(() => fence.acquire(other, target)).toThrow();
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
