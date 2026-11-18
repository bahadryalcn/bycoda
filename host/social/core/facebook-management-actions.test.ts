import { afterEach, expect, it, vi } from "vitest";
import type { FacebookManagementRequest } from "../../../src/features/social/model/facebookManagement";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { createFacebookPageOperations } from "../../../src/integrations/social/adapters/facebook-page-operations";
import { fixture, runCleanups } from "../social-test-support";

afterEach(runCleanups);

it("prepares the exact request from chat and calls Graph once after owner review", async () => {
  const s = await fixture();
  const account = await s.call<SocialAccount>("accounts.create", {
    platform: "facebook",
    accountType: "page",
    name: "Test Page",
    projectIds: [s.a.id],
  });
  await s.social.connectAccount(
    account.id,
    {
      platformId: "123",
      name: "Test Page",
      scopes: ["pages_manage_metadata", "business_management"],
      accessApproved: true,
    },
    { accessToken: "synthetic-facebook-token" },
  );
  await s.call("accounts.grants", {
    accountId: account.id,
    projectId: s.a.id,
    permissions: ["read", "draft"],
  });
  const graph = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
  s.adapters.facebook.facebook = createFacebookPageOperations(new SocialHttp(graph), "v25.0");
  const { principal } = await s.session();
  const input = {
    accountId: account.id,
    operation: "facebook.page.update",
    details: { patch: { about: "Studio A" } },
  };
  const reviewed = await s.call<FacebookManagementRequest>(
    "facebook.management.request",
    input,
    principal,
  );
  expect(reviewed).toMatchObject({ status: "pending", pageId: "123", projectId: s.a.id });
  expect(await s.call("facebook.management.request", input, principal)).toEqual(reviewed);
  expect(graph).not.toHaveBeenCalled();
  await expect(
    s.call("facebook.management.approve", { accountId: account.id, reviewed }, principal),
  ).rejects.toThrow(/owner/i);
  await expect(
    s.call("facebook.management.approve", {
      accountId: account.id,
      reviewed: { ...reviewed, details: { patch: { about: "Different" } } },
    }),
  ).rejects.toThrow("Review");
  expect(graph).not.toHaveBeenCalled();
  await expect(
    s.call("facebook.management.approve", { accountId: account.id, reviewed }),
  ).resolves.toMatchObject({ status: "completed" });
  await expect(
    s.call("facebook.management.approve", { accountId: account.id, reviewed }),
  ).rejects.toThrow("Review");
  expect(graph).toHaveBeenCalledTimes(1);
});
