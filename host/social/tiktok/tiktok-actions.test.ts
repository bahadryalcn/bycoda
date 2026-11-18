import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SocialActionContext } from "../core/social-actions";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import { setTikTokFollowing } from "./browser-audience";
import { tiktokActions } from "./tiktok-actions";

vi.mock("./browser-audience", () => ({
  listTikTokRelationships: vi.fn(),
  setTikTokFollowing: vi.fn(),
}));

const follow = { accountId: "tiktok-1", kind: "follow", recipientId: "web:tiktok:creator" };
const request = tiktokActions["tiktok.changes.request"].run;
const apply = tiktokActions["tiktok.changes.apply"].run;

function fixture() {
  const settings = new Map<string, string>();
  const account = {
    id: "tiktok-1",
    platform: "tiktok",
    connection: "browser",
    connected: true,
    accessApproved: true,
    paused: false,
    platformId: "web:tiktok:owner",
    accountType: "member",
    executorId: "host-1",
  };
  const assertSendable = vi.fn(async () => {});
  const runBrowser = vi.fn(
    async (
      _account: unknown,
      operation: (page: BrowserRecipeContext) => Promise<unknown>,
      options: { beforeSubmit: () => Promise<void>; check: () => Promise<void> },
    ) => {
      await options.check();
      return operation({ beforeSubmit: options.beforeSubmit } as BrowserRecipeContext);
    },
  );
  const ctx = {
    now: () => 60_000,
    operationId: "test",
    principal: { kind: "owner", actorId: "owner" },
    store: {
      findPersonByHandle: async () => ({ id: "person-1" }),
      getSetting: async (key: string) => settings.get(key),
      putSetting: async (key: string, value: string) => {
        settings.set(key, value);
      },
    },
    service: {
      access: async () => account,
      assertSendable,
      authorizeAutonomous: async () => ({ mode: "suggest" }),
      setting: async (key: string) => (key === "sending" ? "true" : undefined),
    },
    tiktok: { executorId: "host-1", runBrowser },
  } as unknown as SocialActionContext;
  return { ctx, runBrowser, assertSendable, account };
}

beforeEach(() => vi.resetAllMocks());

describe("TikTok account change review", () => {
  it("queues an exact owner review and checks resolved suppression before provider submit", async () => {
    const { ctx, runBrowser, assertSendable } = fixture();
    const click = vi.fn();
    vi.mocked(setTikTokFollowing).mockImplementation(
      async (_ctx, target, following, beforeSubmit) => {
        await beforeSubmit();
        click(target);
        return { platformId: target, url: "https://www.tiktok.com/@creator", following };
      },
    );
    const result = (await request(ctx, follow)) as { id: string };
    expect(result).toMatchObject({ state: "pending", change: { recipientId: follow.recipientId } });
    expect(runBrowser).not.toHaveBeenCalled();
    await expect(
      apply(ctx, { accountId: follow.accountId, reviewId: result.id }),
    ).rejects.toMatchObject({ code: "denied" });
    assertSendable.mockRejectedValueOnce(new Error("Recipient suppressed"));
    const approval = { accountId: follow.accountId, reviewId: result.id, confirm: true };
    await expect(apply(ctx, approval)).rejects.toThrow("Recipient suppressed");
    expect(assertSendable).toHaveBeenCalledWith(
      {
        platform: "tiktok",
        platformId: follow.recipientId,
        personId: "person-1",
      },
      "comment",
    );
    expect(click).not.toHaveBeenCalled();
    await expect(apply(ctx, approval)).resolves.toMatchObject({ following: true });
    await expect(apply(ctx, approval)).rejects.toMatchObject({ code: "denied" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("requires owner reconciliation after an uncertain submission", async () => {
    const { ctx } = fixture();
    vi.mocked(setTikTokFollowing).mockImplementation(
      async (_ctx, _target, _following, beforeSubmit) => {
        await beforeSubmit();
        throw new SocialPlatformError("unknown");
      },
    );
    const result = (await request(ctx, follow)) as { id: string };
    const approval = { accountId: follow.accountId, reviewId: result.id, confirm: true };
    await expect(apply(ctx, approval)).resolves.toMatchObject({ status: "unknown" });
    await expect(request(ctx, { ...follow })).rejects.toMatchObject({ code: "unknown" });
    await expect(apply(ctx, approval)).rejects.toMatchObject({ code: "denied" });
    expect(setTikTokFollowing).toHaveBeenCalledTimes(1);
  });
});
