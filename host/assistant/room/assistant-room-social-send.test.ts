import { describe, expect, it, vi } from "vitest";
import { AssistantRoomSocialSend, type RoomSocialSnapshot } from "./assistant-room-social-send";
import type { ManagementReceipt } from "../../conversation/conversation-management-tools";

const principal = { kind: "assistant-thread" as const, threadId: "room", environmentId: "host" };
const proposal = { requestId: "r1", accountId: "a", projectId: "p", action: "replies.send" as const, entityId: "d" };
const authorized = async () => true;
const qualify = async <T>(effect: () => Promise<T>) => effect();
function fixture() {
  const receipts = new Map<string, ManagementReceipt>();
  let snapshot: RoomSocialSnapshot = { accountId: "a", accountGrantVersion: "v1", projectId: "p", projectCwd: "/project", action: "replies.send", entityId: "d", policyVersion: "policy1", effectivePolicy: { max: 80 }, platformLimits: { max: 80 }, payload: { text: "hello", recipient: "person" } };
  const approve = vi.fn(async (operation) => ({ approved: true, operationHash: operation.operationHash }));
  const enqueue = vi.fn(async () => ({ jobId: "job", status: "queued" }));
  const tools = new AssistantRoomSocialSend({ approve, enqueue, readback: async () => ({ status: "queued" }), snapshot: async () => structuredClone(snapshot), receipt: async key => receipts.get(key), saveReceipt: async (key, value) => { receipts.set(key, value); } });
  return { tools, approve, enqueue, change: (next: RoomSocialSnapshot) => { snapshot = next; }, current: () => snapshot };
}

describe("Room Social reviewed sends", () => {
  it("reviews exact source and payload once; queued remains queued", async () => {
    const f = fixture();
    expect(await f.tools.submit(proposal, principal, authorized, "r1", qualify)).toMatchObject({ state: "completed", result: { status: "queued" } });
    expect(f.approve.mock.calls[0][0].input).toMatchObject({ proposal, snapshot: { payload: { text: "hello", recipient: "person" }, policyVersion: "policy1", accountGrantVersion: "v1", projectCwd: "/project" } });
    await f.tools.submit(proposal, principal, authorized, "r1", qualify);
    expect(f.enqueue).toHaveBeenCalledOnce();
    expect(await f.tools.status(principal, "r1", authorized, qualify)).toMatchObject({ result: { status: "queued" } });
  });
  it("rejects changed policy after review and never enqueues", async () => {
    const f = fixture();
    f.approve.mockImplementationOnce(async operation => { f.change({ ...f.current(), policyVersion: "policy2" }); return { approved: true, operationHash: operation.operationHash }; });
    expect(await f.tools.submit(proposal, principal, authorized, "r1", qualify)).toMatchObject({ state: "uncertain" });
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("does not retry unknown effect or allow request ID reuse", async () => {
    const f = fixture();
    f.enqueue.mockRejectedValueOnce(new Error("lost acknowledgement"));
    expect(await f.tools.submit(proposal, principal, authorized, "r1", qualify)).toMatchObject({ state: "uncertain" });
    expect(await f.tools.submit(proposal, principal, authorized, "r1", qualify)).toMatchObject({ state: "uncertain" });
    await expect(f.tools.submit({ ...proposal, entityId: "other" }, principal, authorized, "r1", qualify)).rejects.toThrow();
    expect(f.enqueue).toHaveBeenCalledOnce();
  });
  it("rejects mismatched source before review", async () => {
    const f = fixture();
    f.change({ ...f.current(), accountId: "other" });
    await expect(f.tools.submit(proposal, principal, authorized, "r1", qualify)).rejects.toThrow("source identity changed");
    expect(f.approve).not.toHaveBeenCalled();
  });
  it("does not enqueue when owner denies or authority disappears during review", async () => {
    const denied = fixture();
    denied.approve.mockResolvedValueOnce({ approved: false, operationHash: "" });
    expect(await denied.tools.submit(proposal, principal, authorized, "r1", qualify)).toMatchObject({ state: "failed" });
    expect(denied.enqueue).not.toHaveBeenCalled();
    const revoked = fixture();
    let active = true;
    revoked.approve.mockImplementationOnce(async operation => { active = false; return { approved: true, operationHash: operation.operationHash }; });
    expect(await revoked.tools.submit(proposal, principal, async () => active, "r1", qualify)).toMatchObject({ state: "failed" });
    expect(revoked.enqueue).not.toHaveBeenCalled();
  });
});
