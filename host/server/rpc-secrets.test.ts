import { describe, expect, it, vi } from "vitest";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { handleSecretsOwnerRpc } from "./rpc-secrets";

const view = {
  secretRef: "ref_1",
  projectId: "p1",
  name: "api",
  purpose: "deploy",
  createdAt: 1,
  expiresAt: null,
  materialized: false,
};

function rpc(method: string, params: Record<string, unknown> = {}) {
  return { input: { method }, params, result: undefined } as unknown as OwnerRpcRequest;
}

describe("secrets owner RPC", () => {
  it("lists secret metadata only", async () => {
    const conversationSecrets = { ownerList: vi.fn(async () => [view]), ownerRevoke: vi.fn() };
    const request = rpc("secrets.owner.list");
    await handleSecretsOwnerRpc({ conversationSecrets } as never, request);
    expect(request.result).toEqual({ secrets: [view] });
    expect(JSON.stringify(request.result)).not.toContain("value");
  });

  it("revokes by reference and rejects malformed references", async () => {
    const conversationSecrets = { ownerList: vi.fn(), ownerRevoke: vi.fn(async () => undefined) };
    const request = rpc("secrets.owner.revoke", { secretRef: "ref_1" });
    await handleSecretsOwnerRpc({ conversationSecrets } as never, request);
    expect(conversationSecrets.ownerRevoke).toHaveBeenCalledWith("ref_1");
    expect(request.result).toEqual({ revoked: true });
    for (const secretRef of ["../x", "", "a".repeat(101), 5])
      await expect(
        handleSecretsOwnerRpc(
          { conversationSecrets } as never,
          rpc("secrets.owner.revoke", { secretRef }),
        ),
      ).rejects.toThrow();
    expect(conversationSecrets.ownerRevoke).toHaveBeenCalledTimes(1);
  });
});
