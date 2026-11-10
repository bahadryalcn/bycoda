import { describe, expect, it } from "vitest";
import { ownerApprovalSignature } from "../../src/shared/model/ownerApprovalSignature";
import { ApprovalRegistry } from "../approvals/approval-registry";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { handleApprovalsRpc } from "./rpc-approvals";

const base = {
  id: "a",
  title: "T",
  message: "M",
  confirmLabel: "Yes",
  cancelLabel: "No",
  deadline: Date.now() + 200_000,
  remote: true,
};

function rpc(method: string, tokenHash: string, params: Record<string, unknown> = {}) {
  return { input: { method }, params, tokenHash, result: undefined } as unknown as OwnerRpcRequest;
}

describe("approvals RPC", () => {
  it("separates the desktop principal from a paired phone", async () => {
    const approvals = new ApprovalRegistry();
    approvals.noteDesktop("desk");
    const signature = await ownerApprovalSignature(base);
    const mirror = { upsert: [{ ...base, signature }], remove: [] };
    await expect(
      handleApprovalsRpc({ approvals }, rpc("approvals.mirror", "phone", mirror)),
    ).rejects.toThrow(/desktop/);
    await expect(
      handleApprovalsRpc({ approvals }, rpc("approvals.decisions", "phone")),
    ).rejects.toThrow(/desktop/);
    const ok = rpc("approvals.mirror", "desk", mirror);
    await handleApprovalsRpc({ approvals }, ok);
    expect(ok.result).toEqual({ accepted: 1 });

    const list = rpc("approvals.list", "phone");
    await handleApprovalsRpc({ approvals }, list);
    expect((list.result as { approvals: unknown[] }).approvals).toHaveLength(1);

    const decide = rpc("approvals.decide", "phone", { id: "a", signature, approved: true });
    await handleApprovalsRpc({ approvals }, decide);
    expect(decide.result).toMatchObject({ status: "approved", alreadyDecided: false });
    const poll = rpc("approvals.decisions", "desk");
    await handleApprovalsRpc({ approvals }, poll);
    expect(poll.result).toEqual({ decisions: [{ id: "a", signature, approved: true }] });
  });

  it("rejects a malformed decision", async () => {
    const approvals = new ApprovalRegistry();
    await expect(
      handleApprovalsRpc({ approvals }, rpc("approvals.decide", "phone", { id: "a" })),
    ).rejects.toThrow();
  });
});
