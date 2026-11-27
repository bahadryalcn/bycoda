import { expect, it, vi } from "vitest";
import type { SocialActionContext } from "../core/social-actions";
import { linkedinCreatorActions } from "./linkedin-creator-actions";

const handoff = linkedinCreatorActions["linkedin.creator.handoff"]!;
const input = { accountId: "team", format: "newsletter" };

function fixture(platformId: string) {
  const owner = { kind: "session", projectId: "allowed" };
  const access = vi.fn().mockResolvedValue({
    connected: true,
    platform: "linkedin",
    platformId,
    accountType: "organization",
  });
  const ctx = { service: { access }, principal: owner } as unknown as SocialActionContext;
  return { access, ctx, owner };
}

it("provides a Page-scoped owner handoff using current account grants", async () => {
  const { access, ctx, owner } = fixture("urn:li:organization:1245");
  expect(handoff).toMatchObject({ tool: true, readOnly: true });
  await expect(handoff.run(ctx, input)).resolves.toEqual({
    state: "needs_human",
    format: "newsletter",
    url: "https://www.linkedin.com/company/1245/admin/",
  });
  expect(access).toHaveBeenCalledWith(owner, "team", "read");
  access.mockRejectedValue(new Error("denied"));
  await expect(handoff.run(ctx, input)).rejects.toThrow("denied");
});

it("rejects foreign identities, caller-supplied URLs and unsupported creator formats", async () => {
  const { access, ctx } = fixture("web:linkedin:company:example.com/admin?source=x");
  await expect(handoff.run(ctx, input)).rejects.toMatchObject({ code: "unsupported" });
  access.mockClear();
  await expect(handoff.run(ctx, { ...input, format: "post" })).rejects.toMatchObject({
    code: "unsupported",
  });
  await expect(handoff.run(ctx, { ...input, url: "https://example.com/" })).rejects.toThrow();
  expect(access).not.toHaveBeenCalled();
});
