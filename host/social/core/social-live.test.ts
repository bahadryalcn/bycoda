import { expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { facebookLiveApi } from "../../../src/integrations/social/adapters/facebook-live";
import { createYouTubeQuota } from "../../../src/integrations/social/youtube-quota";
import { instagramStreamRef } from "../browser/instagram-live";
import { createFacebookLiveOperations } from "../facebook-live/actions";
import type { SocialPrincipal } from "../social";
import type { SocialCredential } from "../social-credentials";
import { tiktokLiveSecretId } from "../tiktok/tiktok-actions";
import { youTubeLiveSecretWriter } from "../youtube/live-secret";
import type { SocialActionContext } from "./social-actions";
import { hash } from "./social-helpers";
import {
  createSocialLiveService,
  SocialLiveBroadcastSchema,
  socialLiveConnectionBinding,
} from "./social-live";
import { storeXLiveKey } from "./x-live-key";

const owner: SocialPrincipal = { kind: "owner", actorId: "owner", provider: "owner" };
const session: SocialPrincipal = {
  kind: "session",
  actorId: "session",
  sessionId: "session",
  provider: "codex",
  projectId: "project",
};
const key = "test-only-ingest-key_1234";
const title = "Bycoda Halay";
const youtubeId = "UCabcdefghijklmnopqrstuv";
const broadcastId = "abcdefghijk";
const streamId = "stream-fixture";
const youtubeServer = "rtmps://a.rtmps.youtube.com/live2";

function account(
  platform: SocialAccount["platform"],
  input: Partial<SocialAccount> = {},
): SocialAccount {
  return {
    id: "account",
    platform,
    accountType: "member",
    connection: "browser",
    name: "Example",
    platformId: "123",
    executorId: "host",
    connected: true,
    accessApproved: true,
    paused: false,
    scopes: [],
    grants: { project: ["read", "publish"] },
    createdAt: 1,
    ...input,
  };
}

const youtube = () =>
  account("youtube", { accountType: "channel", platformId: youtubeId, connection: "oauth" });
const facebook = () =>
  account("facebook", {
    accountType: "page",
    connection: "oauth",
    scopes: ["pages_manage_posts", "publish_video"],
  });

function fixture(current: SocialAccount, fetcher = vi.fn<typeof fetch>()) {
  const settings = new Map<string, string>([
    ["sending", "true"],
    ["connectionEpoch:account", "epoch"],
  ]);
  const stored = new Map<string, SocialCredential>();
  const values = new Map<string, string>();
  const credentials = {
    get: async (id: string) => stored.get(id),
    set: async (id: string, value: SocialCredential) => {
      stored.set(id, value);
    },
    delete: async (id: string) => {
      stored.delete(id);
    },
  };
  const vault = {
    get: async (id: string) => values.get(id),
    set: async (id: string, value: string) => {
      values.set(id, value);
    },
    delete: async (id: string) => {
      values.delete(id);
    },
  };
  const now = () => Date.parse("2026-11-18T12:00:00Z");
  const http = new SocialHttp(fetcher);
  const quota = createYouTubeQuota(now);
  const service = {
    accounts: vi.fn(async () => [current]),
    access: vi.fn(
      async (principal: SocialPrincipal, id: string, permission: "read" | "publish") => {
        if (
          id !== current.id ||
          (principal.kind !== "owner" &&
            !current.grants[principal.projectId!]?.includes(permission))
        )
          throw new Error("No access");
        return current;
      },
    ),
    authorizeAutonomous: vi.fn(async (): Promise<{ mode: "approve" | "suggest" }> => ({
      mode: "approve",
    })),
    assertSendable: vi.fn(async () => undefined),
    setting: async (id: string) => settings.get(id),
    setSetting: async (id: string, value: string) => {
      settings.set(id, value);
    },
    adapterFor: () => ({
      management: () => ({ http, token: "synthetic-token", quota, channelId: current.platformId }),
    }),
    credentialFor: async () => ({ accessToken: "synthetic-token" }),
    capability: vi.fn(),
  };
  const verify = vi.fn(async () => undefined);
  const live = createSocialLiveService({
    context: (principal) => ({
      principal,
      environmentId: "host",
      now,
      service: service as unknown as SocialActionContext["service"],
      store: {} as SocialActionContext["store"],
      emailSecrets: vault,
      operationId: "test",
      youtube: { environmentId: "host", credentials, assertAuthorized: verify, media: vi.fn() },
      facebookLive: { environmentId: "host", credentials },
    }),
    verify,
    credentials,
    instagramVault: () => vault,
    xVault: () => vault,
    facebook: createFacebookLiveOperations(() => facebookLiveApi(http, "v25.0")),
    wait: vi.fn(async () => undefined),
  });
  return { live, settings, credentials, vault, fetcher, service, verify };
}

it.each(["instagram", "linkedin", "tiktok", "x"] as const)(
  "resolves %s credentials only inside Host",
  async (platform) => {
    const current = account(platform);
    const f = fixture(current);
    let server: string;
    switch (platform) {
      case "instagram":
        server = "rtmps://live-upload.instagram.com/rtmp/";
        await f.vault.set(
          instagramStreamRef(current.id),
          JSON.stringify({ url: server, key, platformId: current.platformId, epoch: "epoch" }),
        );
        break;
      case "linkedin":
        server = "rtmps://live-ingest.linkedin.com/live?signature=test-secret";
        await f.vault.set(
          `social.linkedin.live.${hash(current.id)}`,
          JSON.stringify({
            version: 1,
            binding: hash(
              JSON.stringify([
                current.connection,
                current.accountType,
                current.platformId,
                "epoch",
              ]),
            ),
            eventId: "1234567",
            storedAt: 1,
            streamUrl: server,
            streamKey: key,
          }),
        );
        break;
      case "tiktok":
        server = "rtmps://push.tiktok.com/ingest";
        await f.credentials.set(tiktokLiveSecretId(current.id), {
          accessToken: JSON.stringify({ serverUrl: server, streamKey: key }),
        });
        break;
      case "x":
        server = "rtmps://or.pscp.tv/x";
        await storeXLiveKey(
          f.vault,
          current.id,
          key,
          server,
          socialLiveConnectionBinding(current, "epoch"),
        );
        break;
    }
    const discovered = await f.live.listAccounts(session);
    expect(discovered).toEqual([{ accountId: current.id, label: current.name, platform }]);
    const prepared = await f.live.prepare(session, current.id, title);
    expect(prepared).toMatchObject({ server, key });
    expect(SocialLiveBroadcastSchema.parse(prepared.broadcast)).toEqual(prepared.broadcast);
    expect(JSON.stringify({ discovered, broadcast: prepared.broadcast })).not.toMatch(
      /test-only-ingest-key|signature|rtmps/,
    );
    await expect(f.live.start(session, prepared.broadcast)).resolves.toBe("owner_required");
    await expect(f.live.end(session, prepared.broadcast)).resolves.toBe("owner_required");
    expect(f.fetcher).not.toHaveBeenCalled();
  },
);

it("requires grants, AI publish autonomy, Social stops, and a current connection before publishing", async () => {
  const current = facebook();
  const f = fixture(current);
  current.grants = { project: ["read"] };
  await expect(f.live.prepare(session, current.id, title)).rejects.toMatchObject({
    code: "LIVE_ACCOUNT_UNAVAILABLE",
  });
  current.grants.project.push("publish");
  f.service.authorizeAutonomous.mockResolvedValueOnce({ mode: "suggest" });
  await expect(f.live.prepare(session, current.id, title)).rejects.toMatchObject({
    code: "LIVE_AUTONOMY_DENIED",
  });
  f.settings.set("ai.stopped", "true");
  await expect(f.live.assertStart(session, current.id)).rejects.toMatchObject({
    code: "LIVE_SOCIAL_STOPPED",
  });
  await expect(f.live.assertStart(owner, current.id)).resolves.toBeUndefined();
  f.settings.set("stopped", "true");
  await expect(f.live.assertStart(owner, current.id)).rejects.toMatchObject({
    code: "LIVE_SOCIAL_STOPPED",
  });
  await expect(f.live.assertAccess(session, current.id, "publish")).resolves.toBeUndefined();
  expect(f.fetcher).not.toHaveBeenCalled();
});

it("redacts corrupted vault entries and ignores legacy X key-only records", async () => {
  const current = account("x");
  const f = fixture(current);
  await storeXLiveKey(f.vault, current.id, key);
  await expect(f.live.listAccounts(owner)).resolves.toEqual([]);
  await expect(f.live.prepare(owner, current.id, title)).rejects.toMatchObject({
    code: "LIVE_MISSING_CREDENTIALS",
  });
  await f.vault.set("social:x:live:account", `{ ${key} `);
  const error = await f.live.prepare(owner, current.id, title).catch((cause: unknown) => cause);
  expect(String(error)).toContain("LIVE_MISSING_CREDENTIALS");
  expect(String(error)).not.toContain(key);
});

it("reuses Facebook's credential and receipt workflow, transitions once, and allows stop under global stops", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        id: "456",
        secure_stream_url: `rtmps://live-api-s.facebook.com/rtmp/${key}`,
      }),
    )
    .mockResolvedValueOnce(Response.json({ id: "456", status: "UNPUBLISHED" }))
    .mockResolvedValueOnce(Response.json({ success: true }))
    .mockResolvedValueOnce(Response.json({ id: "456", status: "LIVE" }))
    .mockResolvedValueOnce(Response.json({ success: true }));
  const f = fixture(facebook(), fetcher);
  const prepared = await f.live.prepare(session, "account", title);
  expect(prepared).toMatchObject({
    server: "rtmps://live-api-s.facebook.com/rtmp/",
    key,
    broadcast: { broadcastId: "456" },
  });
  await expect(f.live.start(session, prepared.broadcast)).resolves.toBe("confirmed");
  f.settings.set("stopped", "true");
  await expect(f.live.end(session, prepared.broadcast)).resolves.toBe("confirmed");
  expect(
    fetcher.mock.calls.flatMap(([, init]) => (init?.body ? [JSON.parse(String(init.body))] : [])),
  ).toEqual([{ status: "UNPUBLISHED", title }, { status: "LIVE_NOW" }, { end_live_video: true }]);
  expect(JSON.stringify([...f.settings])).not.toContain(key);
  await expect(f.credentials.get("facebook.live.encoder:account:456")).resolves.toBeUndefined();
});

it("holds an ambiguous Facebook create with no known broadcast ID", async () => {
  const f = fixture(facebook(), vi.fn<typeof fetch>().mockRejectedValue(new Error(key)));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const error = await f.live.prepare(owner, "account", title).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: "LIVE_PLATFORM_UNCERTAIN",
      broadcast: { accountId: "account" },
    });
    expect(String(error)).not.toContain(key);
  }
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});

function broadcast(status: string, bound = true) {
  return {
    id: broadcastId,
    snippet: { channelId: youtubeId, title },
    contentDetails: bound ? { boundStreamId: streamId } : {},
    status: { privacyStatus: "public", lifeCycleStatus: status },
  };
}

const page = (status: string) => Response.json({ items: [broadcast(status)] });

it("creates and binds a YouTube live broadcast, waits for ingest, starts and completes it", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: youtubeId, status: { selfDeclaredMadeForKids: false } }] }),
    )
    .mockResolvedValueOnce(Response.json(broadcast("created", false)))
    .mockResolvedValueOnce(
      Response.json({
        id: streamId,
        cdn: { ingestionInfo: { rtmpsIngestionAddress: youtubeServer, streamName: key } },
      }),
    )
    .mockResolvedValueOnce(Response.json(broadcast("ready")))
    .mockResolvedValueOnce(page("ready"))
    .mockResolvedValueOnce(page("ready"))
    .mockResolvedValueOnce(Response.json({ items: [{ status: { streamStatus: "inactive" } }] }))
    .mockResolvedValueOnce(page("ready"))
    .mockResolvedValueOnce(Response.json({ items: [{ status: { streamStatus: "active" } }] }))
    .mockResolvedValueOnce(Response.json(broadcast("liveStarting")))
    .mockResolvedValueOnce(page("live"))
    .mockResolvedValueOnce(page("live"))
    .mockResolvedValueOnce(page("live"))
    .mockResolvedValueOnce(Response.json(broadcast("complete")));
  const f = fixture(youtube(), fetcher);
  const prepared = await f.live.prepare(session, "account", title);
  expect(prepared).toMatchObject({
    key,
    server: youtubeServer,
    broadcast: { broadcastId, streamId },
  });
  await expect(f.live.start(session, prepared.broadcast)).resolves.toBe("confirmed");
  await expect(f.live.end(session, prepared.broadcast)).resolves.toBe("confirmed");
  const writes = fetcher.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([url]) => new URL(String(url)));
  expect(writes.map((url) => url.pathname.split("/").slice(3).join("/"))).toEqual([
    "liveBroadcasts",
    "liveStreams",
    "liveBroadcasts/bind",
    "liveBroadcasts/transition",
    "liveBroadcasts/transition",
  ]);
  expect(writes.slice(-2).map((url) => url.searchParams.get("broadcastStatus"))).toEqual([
    "live",
    "complete",
  ]);
});

it("reuses the exact stored YouTube ingest and refuses a changed identity at dispatch", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page("ready"));
  const f = fixture(youtube(), fetcher);
  await youTubeLiveSecretWriter(
    f.credentials,
    "account",
  )({ streamId, rtmpUrl: youtubeServer, streamKey: key });
  const approvedAccount = await f.live.getAccountBinding(owner, "account");
  const beforeDispatch = vi.fn(async () => undefined);
  const destination = await f.live.prepare(
    owner,
    "account",
    title,
    beforeDispatch,
    approvedAccount,
  );
  expect(destination.broadcast.broadcastId).toBe(broadcastId);
  expect(beforeDispatch).not.toHaveBeenCalled();
  f.settings.set("connectionEpoch:account", "new");
  await expect(
    f.live.prepare(owner, "account", title, beforeDispatch, approvedAccount),
  ).rejects.toMatchObject({ code: "LIVE_ACCOUNT_UNAVAILABLE" });
  await expect(f.live.start(owner, destination.broadcast)).rejects.toMatchObject({
    code: "LIVE_ACCOUNT_UNAVAILABLE",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reports partial YouTube provisioning and redacts opaque provider errors", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: youtubeId, status: { selfDeclaredMadeForKids: true } }] }),
    )
    .mockResolvedValueOnce(Response.json(broadcast("created", false)))
    .mockRejectedValueOnce(new Error(key));
  const f = fixture(youtube(), fetcher);
  const error = await f.live.prepare(owner, "account", title).catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "LIVE_PLATFORM_UNCERTAIN", broadcast: { broadcastId } });
  expect(String(error) + JSON.stringify(error)).not.toContain(key);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("refuses the YouTube live transition if the bound encoder changed during readiness", async () => {
  const rebound = { ...broadcast("ready"), contentDetails: { boundStreamId: "unapproved-stream" } };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(page("ready"))
    .mockResolvedValueOnce(page("ready"))
    .mockResolvedValueOnce(Response.json({ items: [rebound] }));
  const f = fixture(youtube(), fetcher);
  await youTubeLiveSecretWriter(
    f.credentials,
    "account",
  )({ streamId, rtmpUrl: youtubeServer, streamKey: key });
  const prepared = await f.live.prepare(owner, "account", title);
  const beforeDispatch = vi.fn(async () => undefined);
  await expect(f.live.start(owner, prepared.broadcast, beforeDispatch)).rejects.toMatchObject({
    code: "LIVE_OWNER_REQUIRED",
  });
  expect(beforeDispatch).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});
