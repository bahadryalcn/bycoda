import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialHttp, SocialPlatformError } from "../../../src/integrations/social/adapter";
import { createYouTubeAdapter } from "../../../src/integrations/social/youtube";
import {
  YOUTUBE_OWNER_WRITES,
  YOUTUBE_READ_TOOLS,
  YOUTUBE_REQUEST_TOOLS,
  YOUTUBE_WRITE_TOOLS,
} from "../../../src/features/social/model/youtubeManagement";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { defaultAutonomyPolicy } from "../autonomy/autonomy-policy";
import { suppress } from "../autonomy/suppression";
import { fixture, owner, runCleanups } from "../social-test-support";
import type { SocialPrincipal } from "../social";
import { youtubeActions } from "./youtube-actions";

const channelId = "UC" + "d".repeat(22);
const targetChannelId = "UC" + "a".repeat(22);
const now = "2026-10-10T09:00:00Z";
const subscribe = "youtube.subscription.change";

afterEach(runCleanups);

async function setup(mode: "suggest" | "approve" | "autonomous" = "autonomous") {
  const f = await fixture();
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/channels"))
      return Response.json({
        items: [
          {
            id: url.searchParams.has("mine") ? channelId : targetChannelId,
            snippet: { title: "Target" },
          },
        ],
      });
    if (options?.method === "POST")
      return Response.json({
        id: "subscription-id",
        snippet: { channelId, resourceId: { channelId: targetChannelId } },
      });
    return Response.json({ items: [] });
  });
  vi.spyOn(f.social, "adapterFor").mockReturnValue(
    createYouTubeAdapter(new SocialHttp(fetcher), () => Date.parse(now)),
  );
  const account = await f.account("youtube");
  await f.social.put<SocialAccount>("account", account.id, {
    ...(await f.social.account(account.id)),
    platformId: channelId,
  });
  const policy = defaultAutonomyPolicy(account.id);
  policy.levels.comment = mode;
  await f.social.audience.putRecord("autonomy", account.id, policy);
  await f.social.setSetting("sending", "true");
  const principal: SocialPrincipal = {
    ...owner,
    kind: "external",
    actorId: "agent",
    projectId: f.a.id,
  };
  const input = { accountId: account.id, targetChannelId, action: "subscribe" };
  return {
    ...f,
    account,
    input,
    principal,
    fetcher,
    writes: () => fetcher.mock.calls.filter(([, opts]) => opts?.method === "POST"),
  };
}

describe("YouTube Host management", () => {
  it("keeps tool catalog and registry permissions in agreement", () => {
    for (const action of YOUTUBE_READ_TOOLS)
      expect(youtubeActions[action]).toMatchObject({
        tool: true,
        readOnly: true,
        ownerOnly: false,
      });
    for (const action of YOUTUBE_WRITE_TOOLS)
      expect(youtubeActions[action]).toMatchObject({
        tool: true,
        readOnly: false,
        ownerOnly: false,
      });
    for (const action of YOUTUBE_REQUEST_TOOLS)
      expect(youtubeActions[action]).toMatchObject({
        tool: true,
        readOnly: false,
        ownerOnly: false,
      });
    for (const action of YOUTUBE_OWNER_WRITES)
      expect(youtubeActions[action]).toMatchObject({ tool: false, ownerOnly: true });
  });

  it("keeps suggestions local and only dispatches the exact approved input", async () => {
    const suggested = await setup("suggest");
    await expect(
      suggested.call(subscribe, suggested.input, suggested.principal, "suggest"),
    ).resolves.toMatchObject({ status: "suggested" });
    expect(suggested.fetcher).not.toHaveBeenCalled();

    const pending = await setup("approve");
    const result = await pending.call<{ id: string; status: string }>(
      subscribe,
      pending.input,
      pending.principal,
      "proposal",
    );
    expect(result.status).toBe("awaiting_approval");
    expect(pending.fetcher).not.toHaveBeenCalled();
    const approval = { accountId: pending.account.id, id: result.id, confirm: true };
    await expect(
      pending.call("youtube.operation.approve", approval, pending.principal),
    ).rejects.toThrow();
    await expect(pending.call("youtube.operation.approve", approval)).resolves.toMatchObject({
      status: "done",
    });
    expect(pending.writes()).toHaveLength(1);
  });

  it("queues owner-only writes for approval and never lets the session run them", async () => {
    expect(youtubeActions["youtube.changes.request"]).toMatchObject({
      tool: true,
      readOnly: false,
      ownerOnly: false,
    });
    const f = await setup("autonomous");
    const cases = [
      ["youtube.video.delete", { videoId: "abcdefghijk" }],
      ["youtube.playlist.delete", { playlistId: "PLfixture" }],
      ["youtube.comment.delete", { commentId: "UgFixtureComment" }],
      ["youtube.community.delete", { postId: "UgFixturePost001" }],
      ["youtube.channel.update", { patch: { description: "New description" } }],
    ] as const;
    for (const [action, input] of cases) {
      const queued = await f.call<{ id: string; status: string; action: string }>(
        "youtube.changes.request",
        { accountId: f.account.id, action, input },
        f.principal,
        action,
      );
      expect(queued).toMatchObject({ status: "awaiting_approval", action });
      // The session cannot approve its own request.
      await expect(
        f.call(
          "youtube.operation.approve",
          { accountId: f.account.id, id: queued.id, confirm: true },
          f.principal,
        ),
      ).rejects.toThrow();
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    // Only owner-only actions can be requested and the exact input is validated.
    await expect(
      f.call(
        "youtube.changes.request",
        { accountId: f.account.id, action: "youtube.video.update", input: {} },
        f.principal,
      ),
    ).rejects.toThrow();
    await expect(
      f.call(
        "youtube.changes.request",
        { accountId: f.account.id, action: "youtube.video.delete", input: { videoId: "x" } },
        f.principal,
      ),
    ).rejects.toThrow();
  });

  it("uses the verified target in suppression and charges only actual dispatch", async () => {
    const f = await setup();
    await suppress(f.social, {
      handle: { platform: "youtube", platformId: targetChannelId },
      channel: "all",
      reason: "manual",
      source: "test",
    });
    await expect(f.call(subscribe, f.input, f.principal, "blocked")).rejects.toThrow(/suppressed/i);
    expect(f.writes()).toHaveLength(0);
  });

  it("honors the channel's Pacific-day subscription cap for owner-approved writes", async () => {
    const f = await setup();
    await f.social.audience.incrementCounter(channelId, "youtube.subscription", "2026-10-10", 10);
    await expect(f.call(subscribe, f.input, owner, "capped")).rejects.toThrow(
      /subscription limit/i,
    );
    expect(f.writes()).toHaveLength(0);
  });

  it("uses publish autonomy for text posts and checks sending before browser preparation", async () => {
    const f = await setup();
    const account = await f.social.account(f.account.id);
    await f.social.put<SocialAccount>("account", account.id, {
      ...account,
      connection: "browser",
      platformId: `web:youtube:${channelId}`,
    });
    const policy = defaultAutonomyPolicy(account.id);
    policy.levels.publish = "autonomous";
    await f.social.audience.putRecord("autonomy", account.id, policy);
    const usedBrowser = vi.fn();
    f.social.youtubeBrowser = async (_account, _run, options) => {
      usedBrowser();
      await options?.beforeSubmit?.();
      return undefined as never;
    };
    const input = { accountId: account.id, kind: "text", text: "Fixture post" };
    await expect(
      f.call("youtube.community.publish", input, f.principal, "text"),
    ).resolves.toMatchObject({ status: "done" });
    await expect(
      f.call(
        "youtube.community.publish",
        { ...input, kind: "image", imageUploadIds: ["upload-id"] },
        f.principal,
        "image",
      ),
    ).resolves.toMatchObject({ status: "awaiting_approval" });
    await f.social.setSetting("sending", "false");
    await expect(f.call("youtube.community.publish", input, owner, "owner")).rejects.toThrow(
      /sending is stopped/,
    );
    expect(usedBrowser).toHaveBeenCalledOnce();
  });

  it("holds Community edits for approval and requires explicit owner deletion", async () => {
    const f = await setup();
    const account = await f.social.account(f.account.id);
    await f.social.put<SocialAccount>("account", account.id, {
      ...account,
      connection: "browser",
      platformId: `web:youtube:${channelId}`,
    });
    const policy = defaultAutonomyPolicy(account.id);
    policy.levels.publish = "approve";
    await f.social.audience.putRecord("autonomy", account.id, policy);
    const usedBrowser = vi.fn();
    f.social.youtubeBrowser = async (_account, _run, options) => {
      usedBrowser();
      await options?.beforeSubmit?.();
      return undefined as never;
    };
    const input = { accountId: account.id, postId: "UgFixturePost001", status: "scheduled" };
    await expect(
      f.call("youtube.community.edit", { ...input, editedText: "Revised text" }, f.principal),
    ).resolves.toMatchObject({ status: "awaiting_approval" });
    await expect(
      f.call("youtube.community.delete", { ...input, confirm: true }, f.principal),
    ).rejects.toThrow();
    await expect(
      f.call("youtube.community.delete", { ...input, confirm: false }, owner),
    ).rejects.toThrow();
    expect(usedBrowser).not.toHaveBeenCalled();
    await expect(
      f.call("youtube.community.delete", { ...input, confirm: true }, owner),
    ).resolves.toMatchObject({ status: "done" });
    expect(usedBrowser).toHaveBeenCalledOnce();
  });

  it("keeps an unknown outcome and prevents blind repeats across request IDs", async () => {
    const f = await setup();
    const respond = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, options) => {
      if (options?.method === "POST") throw new SocialPlatformError("unknown");
      return await respond(input, options);
    });
    const result = await f.call<{ id: string; status: string }>(
      subscribe,
      f.input,
      f.principal,
      "first",
    );
    expect(result.status).toBe("unknown");
    await expect(
      f.call("youtube.operation.status", { id: result.id, accountId: f.account.id }, f.principal),
    ).resolves.toMatchObject({ status: "unknown" });
    await expect(f.call(subscribe, f.input, f.principal, "another")).rejects.toThrow(
      /outcome review/,
    );
    expect(f.writes()).toHaveLength(1);
    const reconciled = {
      accountId: f.account.id,
      id: result.id,
      status: "rejected",
      confirm: true,
    };
    await expect(f.call("youtube.operation.reconcile", reconciled, f.principal)).rejects.toThrow();
    await expect(f.call("youtube.operation.reconcile", reconciled)).resolves.toMatchObject({
      status: "rejected",
      reason: "owner_verified",
    });
  });
});
