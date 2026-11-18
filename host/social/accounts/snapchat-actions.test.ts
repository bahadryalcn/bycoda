import { afterEach, expect, it, vi } from "vitest";
import type {
  SocialAccount,
  SocialCampaign,
  SocialContact,
  SocialDraft,
  SocialJob,
} from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { fixture, owner, runCleanups } from "../social-test-support";

afterEach(async () => {
  vi.unstubAllGlobals();
  await runCleanups();
});

it("resolves the host-bound Snapchat profile and denies another project before network access", async () => {
  const f = await fixture();
  const account = await f.account("snapchat");
  const other = await f.session(f.b.id);
  const fetch = vi.fn(async () =>
    Response.json({
      request_status: "SUCCESS",
      public_profiles: [
        {
          sub_request_status: "SUCCESS",
          public_profile: { id: account.id, display_name: "Example creator", subscriber_count: 0 },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    f.call("snapchat.profile.read", { accountId: account.id }, other.principal),
  ).rejects.toThrow("This project has no permission");
  expect(fetch).not.toHaveBeenCalled();
  await expect(f.call("snapchat.profile.read", { accountId: account.id })).resolves.toMatchObject({
    profileId: account.id,
    name: "Example creator",
    subscribers: 0,
  });
});

it("puts an AI deletion behind owner approval and never repeats an ambiguous deletion", async () => {
  const f = await fixture();
  const account = await f.account("snapchat");
  const session = await f.session();
  const id = "snap-exact-123";
  const deletion = { accountId: account.id, target: "spotlight", id, confirmId: id };
  const fetch = vi.fn(async (_url: string, request: RequestInit) => {
    if (request.method === "DELETE") throw new Error("Lost connection");
    return Response.json({ request_status: "SUCCESS", public_profile: { id: account.id } });
  });
  vi.stubGlobal("fetch", fetch);
  await expect(f.call("snapchat.content.delete", deletion, session.principal)).rejects.toThrow();
  const request = await f.call<{ id: string; status: string }>(
    "snapchat.content.delete.request",
    deletion,
    session.principal,
  );
  expect(request.status).toBe("pending");
  expect(fetch).not.toHaveBeenCalled();
  const review = { accountId: account.id, id: request.id, approve: true };
  await expect(f.call("snapchat.review.decide", review, session.principal)).rejects.toThrow();
  await expect(f.call("snapchat.review.decide", review)).rejects.toBeInstanceOf(
    SocialPlatformError,
  );
  await expect(f.call("snapchat.review.list", { accountId: account.id })).resolves.toMatchObject([
    { id: request.id, status: "review" },
  ]);
  await expect(f.call("snapchat.review.decide", review)).rejects.toThrow();
  await expect(f.call("snapchat.content.delete", deletion)).rejects.toThrow();
  expect(fetch.mock.calls.filter(([, request]) => request.method === "DELETE")).toHaveLength(1);
});

it("queues a Snapchat Saved Story and dispatches the exact approved publication once at its scheduled time", async () => {
  const f = await fixture();
  const account = await f.account("snapchat");
  const scheduledAt = f.clock.value + 60_000;
  const snapchat = {
    target: "saved_story",
    durationSeconds: 0,
    width: 0,
    height: 0,
    savedStorySources: [{ kind: "spotlight", id: "spotlight-exact-123" }],
  };
  const campaign = await f.call<SocialCampaign>("campaigns.create", {
    name: "Saved Story",
    projectIds: [f.a.id],
    variants: [{ accountId: account.id, text: "A collection", media: [], scheduledAt, snapchat }],
  });
  await f.call("campaigns.approve", { id: campaign.id });
  await f.enable();
  const [job] = await f.call<SocialJob[]>("campaigns.schedule", { id: campaign.id }, owner);
  expect(job).toMatchObject({ scheduledAt, status: "queued", payload: { snapchat } });
  await f.social.tick();
  expect(f.send).not.toHaveBeenCalled();
  f.clock.value = scheduledAt;
  await f.social.tick();
  await f.social.tick();
  expect(f.send).toHaveBeenCalledOnce();
  expect(f.send.mock.calls[0]?.[1]).toMatchObject({ id: job.id, payload: { snapchat } });
});

it("passes an exact opaque Public Story ID to the browser and holds an ambiguous result", async () => {
  const f = await fixture();
  const profile = await f.call<SocialAccount>("accounts.create", {
    platform: "snapchat",
    accountType: "public_profile",
    connection: "browser",
    name: "Profile",
    projectIds: [f.a.id],
  });
  await f.social.connectAccount(
    profile.id,
    {
      platformId: "web:snapchat:public_profile:owner",
      name: "Profile",
      scopes: [],
      accessApproved: true,
      connection: "browser",
    },
    { accessToken: "synthetic-browser-token" },
  );
  const browser = vi.fn(async () => {
    throw new SocialPlatformError("unknown");
  });
  f.social.snapchatBrowserProfile = browser;
  const id = "Story-Exact.Opaque";
  const request = { accountId: profile.id, target: "story", id, confirmId: id };
  await expect(f.call("snapchat.content.delete", request)).rejects.toMatchObject({
    code: "unknown",
  });
  await expect(f.call("snapchat.content.delete", request)).rejects.toMatchObject({
    code: "unknown",
  });
  expect(browser).toHaveBeenCalledExactlyOnceWith(owner, profile.id, "delete-story", {
    storyId: id,
    confirm: "DELETE_SNAPCHAT_STORY",
  });
});

it("drafts a new Snapchat chat by exact canonical username without sending", async () => {
  const f = await fixture();
  const member = await f.call<SocialAccount>("accounts.create", {
    platform: "snapchat",
    accountType: "member",
    connection: "browser",
    name: "Member",
    projectIds: [f.a.id],
  });
  await f.social.connectAccount(
    member.id,
    {
      platformId: "web:snapchat:owner",
      name: "Member",
      scopes: [],
      accessApproved: true,
      connection: "browser",
    },
    { accessToken: "synthetic-browser-token" },
  );
  await f.call("accounts.grants", {
    accountId: member.id,
    projectId: f.a.id,
    permissions: ["read", "draft", "message"],
  });
  const session = await f.session();
  const inputs = { accountId: member.id, username: "@Friend_A", text: "Hello" };
  const draft = await f.call<SocialDraft>(
    "snapchat.chat.draft",
    inputs,
    session.principal,
    "new-chat",
  );
  await expect(
    f.call("snapchat.chat.draft", inputs, session.principal, "new-chat"),
  ).resolves.toEqual(draft);
  const [contact] = await f.call<SocialContact[]>("contacts.search", {
    query: "web:snapchat:friend_a",
  });
  expect(contact).toMatchObject({
    id: draft.contactId,
    platformId: "web:snapchat:friend_a",
    accountId: member.id,
  });
  expect(draft).toMatchObject({ kind: "message", text: "Hello", projectId: f.a.id });
  expect(f.send).not.toHaveBeenCalled();
});
