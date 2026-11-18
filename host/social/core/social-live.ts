import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { getYouTubeChannel } from "../../../src/integrations/social/youtube-channel";
import {
  createYouTubeLiveBroadcast,
  getYouTubeLiveBroadcast,
  listYouTubeLiveBroadcasts,
  transitionYouTubeLiveBroadcast,
} from "../../../src/integrations/social/youtube-live";
import { isoTimestamp } from "../../../src/shared/lib/time/timestamps";
import { truncateCodeUnits } from "../../../src/shared/lib/text/truncate";
import type { SecretValueStore } from "../../secrets/secret-store";
import { loadInstagramLiveIngest } from "../browser/instagram-live";
import { facebookLiveOperations } from "../facebook-live/actions";
import { readLiveEncoder, readLiveReceipt } from "../facebook-live/receipts";
import { loadLinkedInLiveIngest } from "../linkedin/linkedin-live";
import type { SocialPrincipal } from "../social";
import type { SocialCredentialStore } from "../social-credentials";
import { parseTikTokLiveCredential } from "../tiktok/browser-live";
import { tiktokLiveSecretId } from "../tiktok/tiktok-actions";
import { loadYouTubeLiveIngest, youTubeLiveSecretWriter } from "../youtube/live-secret";
import { youtubeApi } from "../youtube/youtube-runtime";
import type { SocialActionContext } from "./social-actions";
import { hash } from "./social-helpers";
import { loadXLiveIngest } from "./x-live-key";

const platforms = z.enum(["youtube", "facebook", "instagram", "tiktok", "linkedin", "x"]);
export const SocialLiveBroadcastSchema = z.strictObject({
  accountId: z.string().min(1).max(300),
  platform: platforms,
  platformId: z.string().min(1).max(300),
  connection: z.enum(["oauth", "browser", "token"]).optional(),
  connectionEpoch: z.string().max(300).optional(),
  broadcastId: z
    .string()
    .regex(/^[\w-]{1,30}$/)
    .optional(),
  streamId: z
    .string()
    .regex(/^[\w.=-]{1,400}$/)
    .optional(),
});
export type SocialLiveBroadcast = z.infer<typeof SocialLiveBroadcastSchema>;
type Platform = SocialLiveBroadcast["platform"];
type Destination = { server: string; key: string };
type Context = {
  context(principal: SocialPrincipal): SocialActionContext;
  verify(principal: SocialPrincipal): Promise<void>;
  credentials: SocialCredentialStore;
  instagramVault(): SecretValueStore;
  xVault(): SecretValueStore;
  facebook?: typeof facebookLiveOperations;
  wait?: (ms: number) => Promise<unknown>;
};
type BeforeDispatch = () => Promise<void>;
type LiveAccount = { accountId: string; label: string; platform: Platform };
type ProviderOutcome = "confirmed" | "owner_required";

export type SocialLiveErrorCode =
  | "LIVE_ACCOUNT_UNAVAILABLE"
  | "LIVE_MISSING_CREDENTIALS"
  | "LIVE_OWNER_REQUIRED"
  | "LIVE_SOCIAL_STOPPED"
  | "LIVE_AUTONOMY_DENIED"
  | "LIVE_PLATFORM_REJECTED"
  | "LIVE_PLATFORM_UNCERTAIN";

export class SocialLiveError extends Error {
  constructor(
    public readonly code: SocialLiveErrorCode,
    public readonly broadcast?: SocialLiveBroadcast,
  ) {
    super(code);
  }
}

export interface SocialLiveService {
  listAccounts(principal: SocialPrincipal): Promise<LiveAccount[]>;
  getAccount(principal: SocialPrincipal, accountId: string): Promise<LiveAccount>;
  getAccountBinding(principal: SocialPrincipal, accountId: string): Promise<SocialLiveBroadcast>;
  assertAccess(
    principal: SocialPrincipal,
    accountId: string,
    permission: "read" | "publish",
  ): Promise<void>;
  assertStart(
    principal: SocialPrincipal,
    accountId: string,
    broadcast?: SocialLiveBroadcast,
  ): Promise<void>;
  prepare(
    principal: SocialPrincipal,
    accountId: string,
    title: string,
    beforeDispatch?: BeforeDispatch,
    expectedAccount?: SocialLiveBroadcast,
  ): Promise<Destination & { broadcast: SocialLiveBroadcast }>;
  start(
    principal: SocialPrincipal,
    broadcast: SocialLiveBroadcast,
    beforeDispatch?: BeforeDispatch,
  ): Promise<ProviderOutcome>;
  end(
    principal: SocialPrincipal,
    broadcast: SocialLiveBroadcast,
    beforeDispatch?: BeforeDispatch,
  ): Promise<ProviderOutcome>;
}

function safePlatformError(error: unknown, broadcast?: SocialLiveBroadcast, submitted = true) {
  if (error instanceof SocialLiveError) return error;
  if (error instanceof SocialPlatformError) {
    if (["expired", "unsupported", "needs_human"].includes(error.code))
      return new SocialLiveError("LIVE_OWNER_REQUIRED", broadcast);
    if (["denied", "rate_limit", "rejected"].includes(error.code))
      return new SocialLiveError("LIVE_PLATFORM_REJECTED", broadcast);
  }
  return new SocialLiveError(
    submitted ? "LIVE_PLATFORM_UNCERTAIN" : "LIVE_PLATFORM_REJECTED",
    broadcast,
  );
}

export function socialLiveConnectionBinding(account: SocialAccount, epoch: string | undefined) {
  return hash(JSON.stringify([account.platformId, account.connection, epoch]));
}

export function createSocialLiveService(options: Context): SocialLiveService {
  const facebook = options.facebook ?? facebookLiveOperations;
  const wait = options.wait ?? delay;

  async function access(
    ctx: SocialActionContext,
    accountId: string,
    permission: "read" | "publish",
  ) {
    try {
      await options.verify(ctx.principal);
      return await ctx.service.access(ctx.principal, accountId, permission);
    } catch {
      throw new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE");
    }
  }

  async function liveAccount(ctx: SocialActionContext, accountId: string) {
    const account = await access(ctx, accountId, "publish");
    const platform = platforms.safeParse(account.platform);
    if (
      !platform.success ||
      !account.connected ||
      !account.accessApproved ||
      !account.platformId ||
      account.executorId !== ctx.environmentId
    )
      throw new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE");
    return { ...account, platform: platform.data };
  }

  async function binding(
    ctx: SocialActionContext,
    account: Awaited<ReturnType<typeof liveAccount>>,
  ) {
    return {
      accountId: account.id,
      platform: account.platform,
      platformId: account.platformId,
      connection: account.connection ?? "oauth",
      connectionEpoch: await ctx.service.setting(`connectionEpoch:${account.id}`),
    } satisfies SocialLiveBroadcast;
  }

  function checkBinding(current: SocialLiveBroadcast, expected: SocialLiveBroadcast) {
    if (
      current.accountId !== expected.accountId ||
      current.platform !== expected.platform ||
      current.platformId !== expected.platformId ||
      (expected.connection !== undefined && current.connection !== expected.connection) ||
      current.connectionEpoch !== expected.connectionEpoch
    )
      throw new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE");
  }

  async function assertStart(
    ctx: SocialActionContext,
    accountId: string,
    expected?: SocialLiveBroadcast,
  ) {
    const account = await liveAccount(ctx, accountId);
    if (expected) checkBinding(await binding(ctx, account), expected);
    const ai = ctx.principal.kind !== "owner";
    if (
      account.paused ||
      (await ctx.service.setting("stopped")) === "true" ||
      (await ctx.service.setting("sending")) !== "true" ||
      (ai && (await ctx.service.setting("ai.stopped")) === "true")
    )
      throw new SocialLiveError("LIVE_SOCIAL_STOPPED");
    if (ai) {
      try {
        const decision = await ctx.service.authorizeAutonomous({
          accountId,
          action: "publish",
          principal: ctx.principal,
        });
        if (
          decision.mode === "suggest" ||
          (decision.mode === "autonomous" && decision.scheduledAt > ctx.now())
        )
          throw new SocialLiveError("LIVE_AUTONOMY_DENIED");
      } catch {
        throw new SocialLiveError("LIVE_AUTONOMY_DENIED");
      }
    }
    try {
      await ctx.service.assertSendable(
        { platform: account.platform, platformId: account.platformId },
        "comment",
      );
    } catch {
      throw new SocialLiveError("LIVE_SOCIAL_STOPPED");
    }
    return account;
  }

  async function copiedIngest(
    ctx: SocialActionContext,
    account: Awaited<ReturnType<typeof liveAccount>>,
    expected: SocialLiveBroadcast,
  ): Promise<Destination | undefined> {
    try {
      if (account.platform === "instagram") {
        const result = await loadInstagramLiveIngest(
          options.instagramVault(),
          account.id,
          account.platformId,
          expected.connectionEpoch,
        );
        return result && { server: result.url, key: result.key };
      }
      if (account.platform === "linkedin") return await loadLinkedInLiveIngest(ctx, account);
      if (account.platform === "x")
        return await loadXLiveIngest(
          options.xVault(),
          account.id,
          socialLiveConnectionBinding(account, expected.connectionEpoch),
        );
      if (account.platform === "tiktok") {
        const raw = await options.credentials.get(tiktokLiveSecretId(account.id));
        if (!raw?.accessToken) return;
        const result = parseTikTokLiveCredential(JSON.parse(raw.accessToken));
        return { server: result.serverUrl, key: result.streamKey };
      }
    } catch {
      throw new SocialLiveError("LIVE_MISSING_CREDENTIALS");
    }
  }

  function accountView(account: Awaited<ReturnType<typeof liveAccount>>): LiveAccount {
    return { accountId: account.id, label: account.name, platform: account.platform };
  }

  async function configured(
    ctx: SocialActionContext,
    account: Awaited<ReturnType<typeof liveAccount>>,
  ) {
    if (account.platform === "facebook")
      return (
        account.accountType === "page" &&
        account.connection !== "browser" &&
        ["pages_manage_posts", "publish_video"].every((scope) => account.scopes.includes(scope))
      );
    if (account.platform === "youtube") {
      if (account.accountType !== "channel" || account.connection === "browser") return false;
      ctx.service.capability(account, "live.manage");
      return true;
    }
    return Boolean(await copiedIngest(ctx, account, await binding(ctx, account)));
  }

  async function prepareFacebook(
    ctx: SocialActionContext,
    expected: SocialLiveBroadcast,
    title: string,
    recheck: BeforeDispatch,
    guard: BeforeDispatch,
  ) {
    const { accountId, platformId } = expected;
    let submitted = false;
    let broadcast = expected;
    try {
      const result = await facebook.create(
        ctx,
        { accountId, title: truncateCodeUnits(title, 254) },
        async () => {
          await guard();
          submitted = true;
        },
      );
      if (["creating", "starting", "ending"].includes(result.phase))
        throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN", expected);
      if (result.phase !== "unpublished") throw new SocialLiveError("LIVE_OWNER_REQUIRED");
      broadcast = { ...expected, broadcastId: result.id };
      if (!result.id || !result.encoderReady)
        throw new SocialLiveError("LIVE_MISSING_CREDENTIALS", broadcast);
      const resultIngest = await readLiveEncoder(
        ctx.service,
        options.credentials,
        accountId,
        platformId,
        result.id,
      );
      await recheck();
      return { server: resultIngest.server, key: resultIngest.streamKey, broadcast };
    } catch (error) {
      if (error instanceof SocialLiveError) {
        if (submitted && !error.broadcast) throw new SocialLiveError(error.code, broadcast);
        throw error;
      }
      if (!submitted) throw safePlatformError(error, undefined, false);
      const receipt = await readLiveReceipt(ctx.service, accountId, platformId).catch(
        () => undefined,
      );
      if (receipt?.id) broadcast = { ...expected, broadcastId: receipt.id };
      throw safePlatformError(error, broadcast);
    }
  }

  async function prepareYouTube(
    ctx: SocialActionContext,
    account: SocialAccount,
    expected: SocialLiveBroadcast,
    title: string,
    recheck: BeforeDispatch,
    guard: BeforeDispatch,
  ) {
    let submitted = false;
    let broadcast = expected;
    try {
      const api = await youtubeApi(ctx, account, "live.manage");
      const { http, token, quota } = api;
      const trimmedTitle = truncateCodeUnits(title.trim(), 100);
      const { broadcasts } = await listYouTubeLiveBroadcasts(http, token, quota);
      const ready = broadcasts.filter(
        (entry) =>
          entry.channelId === expected.platformId &&
          entry.title === trimmedTitle &&
          entry.privacyStatus === "public" &&
          (entry.status === "ready" || entry.status === "testing"),
      );
      if (ready.length > 1) throw new SocialLiveError("LIVE_OWNER_REQUIRED");
      const candidate = ready[0];
      if (candidate?.streamId) {
        const ingest = await loadYouTubeLiveIngest(
          options.credentials,
          account.id,
          candidate.streamId,
        );
        if (!ingest) throw new SocialLiveError("LIVE_MISSING_CREDENTIALS");
        await recheck();
        return {
          server: ingest.rtmpUrl,
          key: ingest.streamKey,
          broadcast: { ...expected, broadcastId: candidate.id, streamId: candidate.streamId },
        };
      }
      if (candidate) throw new SocialLiveError("LIVE_OWNER_REQUIRED");
      const { madeForKids } = await getYouTubeChannel(api);
      if (madeForKids === undefined) throw new SocialLiveError("LIVE_OWNER_REQUIRED");
      const scheduledStartTime = isoTimestamp(ctx.now() + 60_000);
      if (!scheduledStartTime) throw new SocialLiveError("LIVE_PLATFORM_REJECTED");
      const result = await createYouTubeLiveBroadcast(
        http,
        token,
        quota,
        {
          title: trimmedTitle,
          privacyStatus: "public",
          madeForKids,
          scheduledStartTime,
        },
        {
          saveIngest: youTubeLiveSecretWriter(options.credentials, account.id),
          disableMonitorStream: true,
          beforeWrite: async () => {
            await guard();
            submitted = true;
          },
          now: ctx.now,
        },
      );
      if (result.status === "partial") {
        broadcast = { ...expected, broadcastId: result.broadcastId, streamId: result.streamId };
        throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN", broadcast);
      }
      broadcast = {
        ...expected,
        broadcastId: result.broadcast.id,
        streamId: result.ingest.streamId,
      };
      if (result.broadcast.channelId !== expected.platformId)
        throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN", broadcast);
      const ingest = await loadYouTubeLiveIngest(
        options.credentials,
        account.id,
        result.ingest.streamId,
        result.ingest.credentialRef,
      );
      if (!ingest) throw new SocialLiveError("LIVE_MISSING_CREDENTIALS", broadcast);
      await recheck();
      return { server: ingest.rtmpUrl, key: ingest.streamKey, broadcast };
    } catch (error) {
      if (error instanceof SocialLiveError && error.broadcast === undefined && submitted)
        throw new SocialLiveError(error.code, broadcast);
      throw safePlatformError(error, submitted ? broadcast : undefined, submitted);
    }
  }

  async function transitionYouTube(
    ctx: SocialActionContext,
    account: SocialAccount,
    broadcast: SocialLiveBroadcast,
    change: "start" | "end",
    recheck: BeforeDispatch,
    guard: BeforeDispatch,
  ): Promise<ProviderOutcome> {
    const broadcastId = broadcast.broadcastId;
    if (!broadcastId) throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN", broadcast);
    const { http, token, quota, channelId } = await youtubeApi(ctx, account, "live.manage");
    const read = () => getYouTubeLiveBroadcast(http, token, quota, channelId, broadcastId);
    const current = await read();
    if (
      current.streamId !== broadcast.streamId ||
      (change === "start" && current.privacyStatus !== "public")
    )
      throw new SocialLiveError("LIVE_OWNER_REQUIRED", broadcast);
    if (change === "end") {
      if (current.status === "ready" || current.status === "created") return "owner_required";
      const ended = await transitionYouTubeLiveBroadcast(
        http,
        token,
        quota,
        channelId,
        broadcastId,
        "complete",
        guard,
        { streamId: broadcast.streamId },
      );
      if (ended.status !== "complete")
        throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN", broadcast);
      return "confirmed";
    }
    // Poll encoder readiness before submitting a transition. Once submitted, only read back.
    const target =
      current.monitorStreamEnabled && current.status !== "testing" ? "testing" : "live";
    const expected = { streamId: broadcast.streamId, privacyStatus: "public" };
    let state = current;
    if (current.status !== "live" && current.status !== "liveStarting") {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await recheck();
        try {
          state = await transitionYouTubeLiveBroadcast(
            http,
            token,
            quota,
            channelId,
            broadcastId,
            target,
            guard,
            expected,
          );
          break;
        } catch (error) {
          if (
            !(error instanceof SocialPlatformError) ||
            error.detail?.reasonCode !== "youtube_live_stream_inactive"
          )
            throw error;
          if (attempt === 14) throw new SocialLiveError("LIVE_OWNER_REQUIRED", broadcast);
          await wait(1_000);
        }
      }
    }
    for (
      let attempt = 0;
      attempt < 15 && ["testStarting", "liveStarting"].includes(state.status ?? "");
      attempt += 1
    ) {
      await wait(1_000);
      state = await read();
    }
    if (target === "testing" && state.status === "testing") {
      state = await transitionYouTubeLiveBroadcast(
        http,
        token,
        quota,
        channelId,
        broadcastId,
        "live",
        guard,
        expected,
      );
      for (let attempt = 0; attempt < 15 && state.status === "liveStarting"; attempt += 1) {
        await wait(1_000);
        state = await read();
      }
    }
    if (
      state.status !== "live" ||
      state.streamId !== expected.streamId ||
      state.privacyStatus !== expected.privacyStatus
    )
      throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN", broadcast);
    return "confirmed";
  }

  async function transition(
    principal: SocialPrincipal,
    broadcast: SocialLiveBroadcast,
    change: "start" | "end",
    beforeDispatch?: BeforeDispatch,
  ): Promise<ProviderOutcome> {
    const ctx = options.context(principal);
    const recheck = async () => {
      if (change === "start") return await assertStart(ctx, broadcast.accountId, broadcast);
      const account = await liveAccount(ctx, broadcast.accountId);
      checkBinding(await binding(ctx, account), broadcast);
      return account;
    };
    try {
      const account = await recheck();
      const check = async () => {
        await recheck();
      };
      const beforeWrite = async () => {
        await beforeDispatch?.();
        await recheck();
      };
      if (broadcast.platform === "youtube")
        return await transitionYouTube(ctx, account, broadcast, change, check, beforeWrite);
      if (broadcast.platform === "facebook") {
        if (!broadcast.broadcastId) throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN", broadcast);
        await facebook.transition(change)(
          ctx,
          { accountId: account.id, liveId: broadcast.broadcastId },
          beforeWrite,
        );
        return "confirmed";
      }
      return "owner_required";
    } catch (error) {
      throw safePlatformError(error, broadcast);
    }
  }

  return {
    async listAccounts(principal) {
      const ctx = options.context(principal);
      await options.verify(principal).catch(() => {
        throw new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE");
      });
      const candidates = await ctx.service.accounts(principal);
      const result: LiveAccount[] = [];
      for (const candidate of candidates) {
        if (!platforms.safeParse(candidate.platform).success) continue;
        try {
          const account = await liveAccount(ctx, candidate.id);
          if (await configured(ctx, account)) result.push(accountView(account));
        } catch {
          // Inaccessible, unset, and corrupt credentials are never exposed on discovery.
        }
      }
      return result;
    },
    async getAccount(principal, accountId) {
      return accountView(await liveAccount(options.context(principal), accountId));
    },
    async getAccountBinding(principal, accountId) {
      const ctx = options.context(principal);
      return await binding(ctx, await liveAccount(ctx, accountId));
    },
    async assertAccess(principal, accountId, permission) {
      await access(options.context(principal), accountId, permission);
    },
    async assertStart(principal, accountId, broadcast) {
      await assertStart(options.context(principal), accountId, broadcast);
    },
    async prepare(principal, accountId, title, beforeDispatch, expectedAccount) {
      const ctx = options.context(principal);
      const account = await assertStart(ctx, accountId, expectedAccount);
      const broadcast = await binding(ctx, account);
      if (expectedAccount) checkBinding(broadcast, expectedAccount);
      const recheck = async () => {
        await assertStart(ctx, accountId, broadcast);
      };
      const guard = async () => {
        await beforeDispatch?.();
        await recheck();
      };
      if (account.platform === "youtube")
        return await prepareYouTube(ctx, account, broadcast, title, recheck, guard);
      if (account.platform === "facebook")
        return await prepareFacebook(ctx, broadcast, title, recheck, guard);
      const ingest = await copiedIngest(ctx, account, broadcast);
      if (!ingest) throw new SocialLiveError("LIVE_MISSING_CREDENTIALS");
      await recheck();
      return { ...ingest, broadcast };
    },
    start: (principal, broadcast, beforeDispatch) =>
      transition(principal, broadcast, "start", beforeDispatch),
    end: (principal, broadcast, beforeDispatch) =>
      transition(principal, broadcast, "end", beforeDispatch),
  };
}
