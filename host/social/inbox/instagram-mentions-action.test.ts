import { expect, it, vi } from "vitest";
import type { SocialActionContext } from "../core/social-actions";
import { instagramActions } from "./instagram-actions";

const action = instagramActions["instagram.mentions"]!;
const account = { id: "ig-connection", platform: "instagram", connection: "api" };

function fixture() {
  const page = { mentions: [{ mediaId: "456", at: 1200 }], coverage: "webhook_only" };
  const access = vi.fn(async () => account);
  const instagramMentions = vi.fn(async () => page);
  const capability = vi.fn();
  const ctx = {
    principal: { kind: "session", projectId: "project" },
    service: { access, capability },
    store: { instagramMentions },
  } as unknown as SocialActionContext;
  return { ctx, access, capability, instagramMentions, page };
}

it("requires account read access before loading bounded mention metadata", async () => {
  const f = fixture();
  await expect(action.run(f.ctx, { accountId: account.id, cursor: "15" })).resolves.toEqual(f.page);
  expect(f.access).toHaveBeenCalledWith(f.ctx.principal, account.id, "read");
  expect(f.capability).toHaveBeenCalledWith(account, "webhook");
  expect(f.instagramMentions).toHaveBeenCalledWith(account.id, "15");
});

it("does not read mention metadata when the principal lacks account access", async () => {
  const f = fixture();
  f.access.mockRejectedValueOnce(new Error("denied"));
  await expect(action.run(f.ctx, { accountId: account.id })).rejects.toThrow("denied");
  expect(f.instagramMentions).not.toHaveBeenCalled();
});
