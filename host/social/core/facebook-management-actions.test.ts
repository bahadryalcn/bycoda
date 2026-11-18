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
    const connect = (photoScope: boolean) =>
      s.social.connectAccount(
        account.id,
        {
          platformId: "123",
          name: "Test Page",
          scopes: [
            "pages_manage_metadata",
            "business_management",
            "pages_read_engagement",
            "pages_manage_posts",
            ...(photoScope ? ["pages_show_list"] : []),
          ],
          accessApproved: true,
        },
        { accessToken: "synthetic-facebook-token" },
      );
    await connect(false);
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
    await expect(s.call("facebook.page.uploadPhoto", input)).rejects.toMatchObject({
      code: "denied",
    });
    expect(graph).not.toHaveBeenCalled();
    await connect(true);
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

async function postEditFixture(mode: "suggest" | "approve" | "autonomous", known = true) {
  const s = await fixture();
  const account = await s.call<SocialAccount>("accounts.create", {
    platform: "facebook",
    accountType: "page",
    name: "Test Page",
    projectIds: [s.a.id, s.b.id],
  });
  await s.social.connectAccount(
    account.id,
    {
      platformId: "123",
      name: "Test Page",
      scopes: ["pages_manage_posts", "pages_read_engagement"],
      accessApproved: true,
    },
    { accessToken: "synthetic-facebook-token" },
  );
  for (const projectId of [s.a.id, s.b.id])
    await s.call("accounts.grants", {
      accountId: account.id,
      projectId,
      permissions: ["read", "publish"],
    });
  await s.call("autonomy.set", {
    accountId: account.id,
    policy: { levels: { publish: mode }, limits: { publish: 1 } },
    confirm: "ENABLE_AUTONOMY",
  });
  await s.enable();
  const graph = vi.fn<typeof fetch>(async (_url, request) =>
    request?.method === "POST"
      ? Response.json({ success: known })
      : Response.json({ id: "123_456", from: { id: "123" } }),
  );
  s.adapters.facebook.facebook = createFacebookPageOperations(new SocialHttp(graph), "v25.0");
  const { principal } = await s.session();
  const request = (text = "Edited copy") =>
    s.call<FacebookManagementRequest>(
      "facebook.management.request",
      {
        accountId: account.id,
        operation: "facebook.post.edit",
        details: { postId: "123_456", text },
      },
      principal,
    );
  const item = await request();
  const action = "facebook.management.execute";
  const input = { accountId: account.id, id: item.id };
  return { s, account, principal, item, action, input, graph, request };
}

it("lets only the originating project apply an exact owner-approved write in chat", async () => {
  const { s, account, principal, item, action, input, graph } = await postEditFixture("approve");
  await expect(s.call(action, input, principal)).rejects.toThrow("owner approval");
  await expect(s.call(action, input, (await s.session(s.b.id)).principal)).rejects.toThrow(
    "this project",
  );
  await expect(
    s.call(
      "facebook.management.approve",
      { accountId: account.id, reviewed: item, forChat: true },
      principal,
    ),
  ).rejects.toThrow(/owner/i);
  expect(graph).not.toHaveBeenCalled();
  await expect(
    s.call("facebook.management.approve", { accountId: account.id, reviewed: item, forChat: true }),
  ).resolves.toMatchObject({ status: "approved" });
  expect(graph).not.toHaveBeenCalled();
  await expect(s.call(action, { ...input, text: "Tampered copy" }, principal)).rejects.toThrow();
  await expect(s.call(action, input, principal)).resolves.toMatchObject({ status: "completed" });
  await expect(s.call(action, input, principal)).resolves.toMatchObject({ status: "completed" });
  expect(graph.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "POST"]);
  expect(graph.mock.calls[1][1]?.body).toContain("Edited copy");
});

it("holds uncertain autonomous edits across Host restarts and charges the policy counter once", async () => {
  const { s, account, principal, action, input, graph, request } = await postEditFixture(
    "autonomous",
    false,
  );
  await expect(s.call(action, input, principal)).rejects.toMatchObject({ code: "unknown" });
  await s.restart();
  await expect(s.call(action, input, principal)).resolves.toMatchObject({ status: "review" });
  await expect(request()).resolves.toMatchObject({ id: input.id, status: "review" });
  const next = await request("Another revision");
  await expect(s.call(action, { accountId: account.id, id: next.id }, principal)).rejects.toThrow(
    /deferred/i,
  );
  expect(graph.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "POST"]);
});

it("keeps a suggested edit pending and respects sending stop at dispatch", async () => {
  const { s, account, principal, action, input, graph } = await postEditFixture("suggest");
  await expect(s.call(action, input, principal)).rejects.toThrow("owner approval");
  await s.call("autonomy.set", {
    accountId: account.id,
    policy: { levels: { publish: "autonomous" } },
    confirm: "ENABLE_AUTONOMY",
  });
  await s.social.setSetting("ai.stopped", "true");
  await expect(s.call(action, input, principal)).rejects.toThrow(/stopped/i);
  expect(graph).not.toHaveBeenCalled();
  await s.social.setSetting("ai.stopped", "false");
  await expect(s.call(action, input, principal)).resolves.toMatchObject({ status: "completed" });
  expect(graph).toHaveBeenCalledTimes(2);
});
