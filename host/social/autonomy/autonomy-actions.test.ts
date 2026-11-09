import { describe, expect, it, vi } from "vitest";
import type { SocialActionContext } from "../core/social-actions";
import type { SocialPrincipal } from "../social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { autonomyActions } from "./autonomy-actions";

const OWNER: SocialPrincipal = { kind: "owner", actorId: "owner:me", provider: "owner" };
const AI: SocialPrincipal = {
  kind: "session",
  actorId: "session:ai",
  sessionId: "s1",
  provider: "codex",
  projectId: "p1",
};

/** Email account ids live in the audience store; social account ids go through the service. */
function ctx(principal: SocialPrincipal) {
  const records = new Map<string, unknown>([["email-account:email-1", { id: "email-1" }]]);
  const service = {
    owner: vi.fn((p: SocialPrincipal) => {
      if (p.kind !== "owner") throw new Error("Only the account owner can do this.");
    }),
    access: vi.fn(async () => ({})),
    account: vi.fn(async (id: string) => {
      throw new Error(`Social account ${id} not found.`);
    }),
  };
  const store = {
    getRecord: async (kind: string, id: string) => records.get(`${kind}:${id}`),
  } as unknown as SocialAudienceStore;
  return {
    service,
    context: {
      service,
      store,
      now: () => 1,
      principal,
      operationId: "op",
    } as unknown as SocialActionContext,
  };
}

describe("autonomy actions for email accounts", () => {
  it("reads the policy of an email account with the owner check, not a social account lookup", async () => {
    const { context, service } = ctx(OWNER);
    const policy = await autonomyActions["autonomy.get"].run(context, { accountId: "email-1" });
    expect(policy).toMatchObject({ accountId: "email-1" });
    expect(service.account).not.toHaveBeenCalled();
    expect(service.access).not.toHaveBeenCalled();
  });

  it("refuses an AI principal on an email account policy", async () => {
    const { context } = ctx(AI);
    await expect(
      autonomyActions["autonomy.get"].run(context, { accountId: "email-1" }),
    ).rejects.toThrow("Only the account owner");
  });

  it("keeps the social account check for an unknown social account", async () => {
    const { context, service } = ctx(OWNER);
    await expect(
      autonomyActions["autonomy.set"].run(context, { accountId: "acc-x", policy: {} }),
    ).rejects.toThrow("not found");
    expect(service.account).toHaveBeenCalledWith("acc-x");
  });
});
