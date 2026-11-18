import { afterEach, expect, it, vi } from "vitest";
import type { FacebookManagementRequest } from "../../../src/features/social/model/facebookManagement";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { createFacebookPageOperations } from "../../../src/integrations/social/adapters/facebook-page-operations";
import { fixture, runCleanups } from "../social-test-support";

afterEach(runCleanups);

it.each(["avatar", "cover"])(
  "applies a local file to the Facebook Page %s through Graph",
  async (kind) => {
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
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlll1sAAAAASUVORK5CYII=";
    const { uploadId } = await s.social.uploadImage(
      { kind: "owner", actorId: "owner", provider: "owner" },
      base64,
    );
    const graph = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "777" }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    s.adapters.facebook.facebook = createFacebookPageOperations(new SocialHttp(graph), "v25.0");
    const input = { accountId: account.id, kind, uploadId, confirm: "UPLOAD_FACEBOOK_PAGE_PHOTO" };
    await expect(
      s.call("facebook.page.uploadPhoto", input, (await s.session()).principal),
    ).rejects.toThrow(/owner/i);
    expect(graph).not.toHaveBeenCalled();
    await expect(s.call("facebook.page.uploadPhoto", input)).resolves.toMatchObject({
      status: "updated",
    });
    expect(graph).toHaveBeenCalledTimes(2);
    expect(String(graph.mock.calls[0][0])).toMatch(/\/123\/photos$/);
    const form = graph.mock.calls[0][1]?.body as FormData;
    expect(form.get("published")).toBe("false");
    expect((form.get("source") as Blob).type).toBe("image/png");
    expect(String(graph.mock.calls[1][0])).toMatch(
      kind === "avatar" ? /\/123\/picture$/ : /\/123$/,
    );
    expect(graph.mock.calls[1][1]?.body).toContain('"777"');
  },
);

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
