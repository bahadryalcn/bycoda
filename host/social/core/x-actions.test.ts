import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp, type SocialAdapter } from "../../../src/integrations/social/adapter";
import type { SocialActionContext } from "./social-actions";
import { createXActions } from "./x-actions";
import { storeXLiveKey } from "./x-live-key";

const request = {
  accountId: "account",
  userId: "123",
  kind: "follow",
  enabled: true,
  confirm: "APPLY_X_ACTION",
  intentId: "692f5dee-0000-4000-8000-000000000001",
};

function fixture({ paid = true, suppress = false, unknown = false, browser = false } = {}) {
  const fetcher = vi.fn(async () => {
    if (unknown) throw new Error("connection lost");
    return Response.json({ data: { following: false, pending_follow: true } });
  });
  const settings = new Map<string, string>([["sending", "true"]]);
  const account = {
    id: "account",
    executorId: "host",
    platform: "x",
    platformId: "234",
    connection: browser ? "browser" : "oauth",
    xApiProduct: paid ? "pay-per-use" : undefined,
    connected: true,
    accessApproved: true,
    scopes: ["follows.write"],
  } satisfies Partial<SocialAccount>;
  const assertSendable = vi.fn(async () => {
    if (suppress) throw new Error("Recipient is suppressed.");
  });
  const deletePost = vi.fn<NonNullable<SocialAdapter["deletePost"]>>(async () => {});
  const ctx = {
    principal: { kind: "owner" },
    executorId: "host",
    now: () => 100_000,
    service: {
      owner: (principal: { kind: string }) => {
        if (principal.kind !== "owner") throw new Error("Owner required.");
      },
      access: async () => account,
      credentialFor: async () => ({ accessToken: "secret" }),
      capability: vi.fn(),
      adapterFor: () => ({ deletePost }),
      setting: async (key: string) => settings.get(key),
      setSetting: async (key: string, value: string) => settings.set(key, value),
      assertSendable,
    },
  } as unknown as SocialActionContext;
  const actions = createXActions(new SocialHttp(fetcher));
  return { fetcher, actions, ctx, assertSendable, deletePost, settings };
}

describe("X account actions", () => {
  it("refuses historical insights on self-serve before requesting credentials or metrics", async () => {
    const { actions, ctx, fetcher } = fixture();
    const credentialFor = vi.spyOn(ctx.service, "credentialFor");
    await expect(actions["x.insights"].run(ctx, { accountId: "account" })).rejects.toThrow(
      "Enterprise",
    );
    expect(credentialFor).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses paid X operations outside the account's active executor", async () => {
    const { actions, ctx, fetcher } = fixture();
    await expect(actions["x.apply"].run({ ...ctx, executorId: "other" }, request)).rejects.toThrow(
      "active executor Host",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns fixed browser destinations without contacting X", async () => {
    const { actions, ctx, fetcher } = fixture({ paid: false });
    await expect(
      actions["x.handoff"].run(ctx, {
        accountId: "account",
        destination: "post",
        target: "123",
      }),
    ).resolves.toEqual({ status: "needs_human", url: "https://x.com/i/web/status/123" });
    await expect(
      actions["x.handoff"].run(ctx, { accountId: "account", destination: "spaces" }),
    ).resolves.toEqual({ status: "needs_human", url: "https://help.x.com/en/using-x/spaces" });
    await expect(
      actions["x.handoff"].run(ctx, {
        accountId: "account",
        destination: "post",
        target: "123/../../",
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses write I/O for unconfirmed, ownerless, disabled or suppressed actions", async () => {
    const { actions, ctx, fetcher, assertSendable } = fixture({ suppress: true });
    const apply = actions["x.apply"].run;
    await expect(apply(ctx, { ...request, confirm: undefined })).rejects.toThrow("Confirm");
    await expect(
      apply({ ...ctx, principal: { kind: "session" } } as SocialActionContext, request),
    ).rejects.toThrow("Owner required");
    await expect(apply(ctx, request)).rejects.toThrow("suppressed");
    expect(assertSendable).toHaveBeenCalledWith({ platform: "x", platformId: "123" }, "comment");
    expect(fetcher).not.toHaveBeenCalled();
    const off = fixture({ paid: false });
    await expect(off.actions["x.apply"].run(off.ctx, request)).rejects.toThrow("paid X");
    expect(off.fetcher).not.toHaveBeenCalled();
  });

  it("persists the exact confirmed result and dispatches once", async () => {
    const { actions, ctx, fetcher } = fixture();
    const apply = actions["x.apply"].run;
    const expected = {
      status: "applied",
      result: { userId: "123", enabled: false, pending: true },
    };
    await expect(apply(ctx, request)).resolves.toEqual(expected);
    await expect(apply(ctx, request)).resolves.toEqual(expected);
    await expect(apply(ctx, { ...request, userId: "567" })).rejects.toThrow("another X action");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("holds an uncertain write and never replays its confirmation", async () => {
    const { actions, ctx, fetcher } = fixture({ unknown: true });
    const apply = actions["x.apply"].run;
    await expect(apply(ctx, request)).resolves.toEqual({ status: "review" });
    await expect(apply(ctx, request)).resolves.toEqual({ status: "review" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("deletes one exact post through the browser without paid API credentials", async () => {
    const { actions, ctx, fetcher, deletePost } = fixture({ paid: false, browser: true });
    const credentialFor = vi.spyOn(ctx.service, "credentialFor");
    const deletion = { ...request, kind: "deletePost", postId: "123" };
    await expect(actions["x.apply"].run(ctx, deletion)).resolves.toEqual({
      status: "applied",
      result: { postId: "123" },
    });
    await expect(actions["x.apply"].run(ctx, deletion)).resolves.toMatchObject({
      status: "applied",
    });
    expect(deletePost).toHaveBeenCalledTimes(1);
    expect(deletePost).toHaveBeenCalledWith(
      expect.objectContaining({ connection: "browser" }),
      "",
      "123",
      expect.any(Function),
    );
    expect(credentialFor).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rechecks sending authority inside the browser before committing deletion", async () => {
    const { actions, ctx, deletePost, settings } = fixture({ paid: false, browser: true });
    deletePost.mockImplementationOnce(async (_account, _token, _postId, authorize) => {
      settings.set("stopped", "true");
      await authorize?.();
    });
    await expect(
      actions["x.apply"].run(ctx, { ...request, kind: "deletePost", postId: "123" }),
    ).resolves.toEqual({ status: "review" });
  });
});

it("keeps the stream key in the vault and scrubs vault errors", async () => {
  const vault = { set: vi.fn(async () => {}), get: vi.fn(), delete: vi.fn() };
  await expect(storeXLiveKey(vault, "account", "test-stream-key")).resolves.toEqual({
    stored: true,
  });
  expect(vault.set).toHaveBeenCalledWith("social:x:live:account", "test-stream-key");
  vault.set.mockRejectedValueOnce(new Error("test-stream-key"));
  await expect(storeXLiveKey(vault, "account", "test-stream-key")).rejects.toThrow(
    /^The Host could not save the X stream key\.$/,
  );
});
