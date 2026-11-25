import { expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { facebookPageActions } from "./facebook-page-actions";
import type { SocialActionContext } from "./social-actions";

it("dispatches a verified browser Page deletion once and holds an uncertain receipt across calls", async () => {
  const account = {
    id: "browser-page",
    platform: "facebook",
    platformId: "123",
    accountType: "page",
    connection: "browser",
    connected: true,
    accessApproved: true,
    executorId: "fixture",
  } as SocialAccount;
  const settings = new Map([["sending", "true"]]);
  const deletePost = vi.fn(async (_account, _token, _target, guard: () => Promise<void>) => {
    await guard();
    throw new SocialPlatformError("unknown");
  });
  const service = {
    access: vi.fn(async () => account),
    capability: vi.fn(),
    adapterFor: () => ({ deletePost }),
    setting: async (name: string) => settings.get(name),
    setSetting: async (name: string, value: string) => {
      settings.set(name, value);
    },
  };
  const ctx: SocialActionContext = {
    service: service as unknown as SocialActionContext["service"],
    store: { environmentId: "fixture" } as SocialActionContext["store"],
    now: () => 1,
    principal: { kind: "owner", actorId: "operator", provider: "owner" },
    operationId: "test",
  };
  const action = facebookPageActions["facebook.post.delete"];
  const input = { accountId: account.id, confirm: "DELETE_FACEBOOK_POST" };
  await expect(
    action.run(ctx, {
      ...input,
      postId: "https://www.facebook.com/permalink.php?story_fbid=456&id=123",
    }),
  ).rejects.toMatchObject({ code: "unknown" });
  await expect(
    action.run(ctx, { ...input, postId: "https://www.facebook.com/123/posts/456/" }),
  ).rejects.toMatchObject({ code: "unknown" });
  expect(deletePost).toHaveBeenCalledTimes(1);
});

it("requires exact owner confirmation and holds an uncertain Graph mutation across calls", async () => {
  const account = {
    id: "a",
    platform: "facebook",
    platformId: "123",
    accountType: "page",
    connection: "oauth",
    connected: true,
    accessApproved: true,
    executorId: "fixture",
  } as SocialAccount;
  const settings = new Map<string, string>();
  const deletePost = vi.fn().mockRejectedValue(new SocialPlatformError("unknown"));
  const service = {
    access: vi.fn(async () => account),
    capability: vi.fn(),
    adapterFor: () => ({ facebook: {}, deletePost }),
    credentialFor: async () => ({ accessToken: "synthetic" }),
    setting: async (name: string) => settings.get(name),
    setSetting: async (name: string, value: string) => {
      settings.set(name, value);
    },
  };
  const ctx: SocialActionContext = {
    service: service as unknown as SocialActionContext["service"],
    store: {} as SocialActionContext["store"],
    now: () => 1,
    principal: { kind: "owner", actorId: "operator", provider: "owner" },
    operationId: "test",
    facebookLive: {
      environmentId: "fixture",
      credentials: {} as NonNullable<SocialActionContext["facebookLive"]>["credentials"],
    },
  };
  const action = facebookPageActions["facebook.post.delete"];
  expect(action.ownerOnly).toBe(true);
  await expect(action.run(ctx, { accountId: "a", postId: "123_456" })).rejects.toThrow(
    "confirmation",
  );
  const input = { accountId: "a", postId: "123_456", confirm: "DELETE_FACEBOOK_POST" };
  await expect(action.run(ctx, input)).rejects.toMatchObject({ code: "unknown" });
  await expect(action.run({ ...ctx, service: { ...ctx.service } }, input)).rejects.toMatchObject({
    code: "unknown",
  });
  expect(deletePost).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([...settings.values()])).not.toContain("synthetic");
});
