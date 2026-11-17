import { describe, expect, it, vi } from "vitest";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { handleSecretsOwnerRpc, handleSecretInputRpc } from "./rpc-secrets";

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
  it("routes transient owner inputs without retaining or returning values", async () => {
    const conversationDesktop = {
      secretInputs: vi.fn(async () => ({ requests: [] })),
      answerSecretInput: vi.fn(async () => ({ accepted: true })),
    };
    const authorized = async () => true;
    const list = {
      ...rpc("secrets.input.list", { sessionId: "s" }),
      domainContext: { authorized },
    } as OwnerRpcRequest;
    await handleSecretInputRpc({ conversationDesktop } as never, list);
    expect(conversationDesktop.secretInputs).toHaveBeenCalledWith("s", authorized);
    const answer = {
      ...rpc("secrets.input.answer", { id: "r", signature: "a".repeat(64), cancelled: true }),
      domainContext: { authorized },
    } as OwnerRpcRequest;
    await handleSecretInputRpc({ conversationDesktop } as never, answer);
    expect(conversationDesktop.answerSecretInput).toHaveBeenCalledWith(answer.params, authorized);
    expect(answer.result).toEqual({ accepted: true });
  });
  it("refuses revoked owner input callers before accessing the relay", async () => {
    const conversationDesktop = { secretInputs: vi.fn(), answerSecretInput: vi.fn() };
    for (const method of ["secrets.input.list", "secrets.input.answer"]) {
      const request = {
        ...rpc(method),
        domainContext: { authorized: async () => false },
      } as OwnerRpcRequest;
      await expect(handleSecretInputRpc({ conversationDesktop } as never, request)).rejects.toThrow(
        "Device authorization was revoked",
      );
    }
    expect(conversationDesktop.secretInputs).not.toHaveBeenCalled();
    expect(conversationDesktop.answerSecretInput).not.toHaveBeenCalled();
  });
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
