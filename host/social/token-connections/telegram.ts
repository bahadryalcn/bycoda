import { createHash, createHmac, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SocialHttp } from "../../../src/integrations/social/adapter";
import {
  deleteTelegramWebhook,
  setTelegramWebhook,
} from "../../../src/integrations/social/adapters/telegram-api";
import type {
  SocialAccount,
  SocialTelegramChannelReview,
} from "../../../src/features/social/model/social";
import type { SocialPrincipal } from "../social";
import type { TokenAvailability, TokenConnectionDeps, VerifiedTokenIdentity } from "./types";

type ChannelIdentity = Omit<SocialTelegramChannelReview, "reviewId" | "expiresAt">;
type ChannelReview = {
  public: SocialTelegramChannelReview;
  account: SocialAccount;
  actorId: string;
  provider: string;
  executorId: string;
  tokenFingerprint: string;
  connectionEpoch?: string;
};
const tokenFingerprint = (token: string) => createHash("sha256").update(token).digest("hex");
const safeId = (value: unknown, negative = false): value is number =>
  Number.isSafeInteger(value) && (negative ? Number(value) < 0 : Number(value) > 0);
const username = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_]{5,32}$/.test(value);
const channelTarget = (target: unknown): string => {
  if (typeof target !== "string")
    throw new Error("Enter a Telegram channel ID or public username.");
  if (/^@[A-Za-z0-9_]{5,32}$/.test(target)) return target;
  if (
    /^-[1-9]\d{0,15}$/.test(target) &&
    safeId(Number(target), true) &&
    String(Number(target)) === target
  )
    return target;
  throw new Error("Enter a Telegram channel ID or public username.");
};

export function telegramAvailability(env: NodeJS.ProcessEnv): TokenAvailability {
  const configured = !!env.BYCODA_SOCIAL_TELEGRAM_TOKEN;
  return {
    configured,
    reason: configured
      ? "Host token present; verify the identity before connecting."
      : "Configure BYCODA_SOCIAL_TELEGRAM_TOKEN on the host.",
  };
}

/**
 * The token a Telegram connection uses. The vault credential wins; the host env token is read only
 * to import a bot that has no stored credential yet (B31). Rotation means reconnecting after disconnect.
 */
export async function telegramToken(
  deps: TokenConnectionDeps,
  accountId: string,
): Promise<{ token: string; imported: boolean } | undefined> {
  const stored = await deps.social.credentialFor(accountId);
  if (stored?.accessToken) return { token: stored.accessToken, imported: false };
  const token = deps.env.BYCODA_SOCIAL_TELEGRAM_TOKEN;
  return token ? { token, imported: true } : undefined;
}

/** Only an import takes the approval flag from the host env; later reconnects keep the saved decision. */
function accessApprovedFor(
  resolved: { imported: boolean },
  account: Pick<SocialAccount, "accessApproved">,
  env: NodeJS.ProcessEnv,
): boolean {
  return resolved.imported ? env.BYCODA_SOCIAL_TELEGRAM_APPROVED === "1" : account.accessApproved;
}

/**
 * Per-account webhook secret derived from the vault token. Nothing extra is stored; the webhook
 * receiver recomputes it. Rotating the bot token therefore invalidates the old secret.
 */
export function telegramWebhookSecret(token: string, accountId: string): string {
  return createHmac("sha256", token)
    .update(`bycoda-telegram-webhook:${accountId}`)
    .digest("base64url");
}

/** Verifies a bot token for a Telegram bot account. The existing webhook decides whether polling is allowed. */
export async function verifyTelegramBot(
  http: SocialHttp,
  token: string,
): Promise<VerifiedTokenIdentity> {
  const profile = await http.telegram("getMe", token);
  if (!profile.is_bot || !Number.isSafeInteger(profile.id) || !profile.username)
    throw new Error("Telegram bot identity verification failed.");
  const webhook = await http.telegram("getWebhookInfo", token);
  return {
    platformId: String(profile.id),
    name: `@${profile.username}`,
    scopes: ["bot.send", ...(!webhook.url ? ["bot.poll"] : [])],
  };
}

/**
 * Registers or removes the webhook for a bot account that already has a vault credential. The owner
 * must reconnect afterwards so the bot.poll scope matches the webhook state.
 */
export async function setBotWebhook(
  deps: TokenConnectionDeps,
  p: SocialPrincipal,
  accountId: string,
  url: string | undefined,
): Promise<void> {
  const account = await deps.social.accountForOAuth(p, accountId);
  if (account.platform !== "telegram" || account.accountType !== "bot")
    throw new Error("Choose a Telegram bot token connection.");
  const stored = await deps.social.credentialFor(accountId);
  if (!stored?.accessToken) throw new Error("Connect the bot before changing its webhook.");
  if (url === undefined) {
    await deleteTelegramWebhook(deps.http, stored.accessToken);
    return;
  }
  await setTelegramWebhook(
    deps.http,
    stored.accessToken,
    url,
    telegramWebhookSecret(stored.accessToken, accountId),
  );
}

/** Telegram channel review: inspect a channel, hold the reviewed identity briefly, then connect only that identity. */
export class TelegramChannelConnections {
  private readonly channelReviews = new Map<string, ChannelReview>();
  constructor(private readonly deps: TokenConnectionDeps) {}

  private async channelAccount(p: SocialPrincipal, accountId: string, writing = false) {
    const account = await this.deps.social.accountForBrowserManagement(p, accountId, writing);
    if (
      account.platform !== "telegram" ||
      account.accountType !== "channel" ||
      (account.connection !== undefined && account.connection !== "token")
    )
      throw new Error("Choose a Telegram channel token connection.");
    if (account.executorId !== this.deps.social.store.environmentId)
      throw new Error("Connect the channel on its selected executor host.");
    if (account.paused) throw new Error("The social account is paused.");
    return account;
  }

  private async telegramChannel(token: string, target: string): Promise<ChannelIdentity> {
    const { http } = this.deps;
    try {
      const bot = await http.telegram("getMe", token);
      if (bot.is_bot !== true || !safeId(bot.id) || !username(bot.username)) throw new Error();
      const chat = await http.telegram("getChat", token, { chat_id: target });
      if (
        chat.type !== "channel" ||
        chat.is_direct_messages ||
        !safeId(chat.id, true) ||
        typeof chat.title !== "string" ||
        !chat.title.trim() ||
        chat.title.length > 300 ||
        chat.title.includes("\0") ||
        (chat.username !== undefined && !username(chat.username))
      )
        throw new Error();
      const id = String(chat.id);
      if (target.startsWith("@")) {
        const names = [
          chat.username,
          ...(Array.isArray(chat.active_usernames) ? chat.active_usernames : []),
        ];
        if (
          !names.some(
            (name) => username(name) && name.toLowerCase() === target.slice(1).toLowerCase(),
          )
        )
          throw new Error();
      } else if (id !== target) throw new Error();
      const member = await http.telegram("getChatMember", token, {
        chat_id: id,
        user_id: bot.id,
      });
      if (
        member.status !== "administrator" ||
        member.can_post_messages !== true ||
        member.user?.id !== bot.id ||
        member.user?.is_bot !== true
      )
        throw new Error();
      return {
        channelId: id,
        channelName: chat.title,
        ...(chat.username ? { username: chat.username } : {}),
        botId: String(bot.id),
        botName: `@${bot.username}`,
      };
    } catch {
      throw new Error(
        "Telegram channel verification failed. Check channel access and the bot's posting rights.",
      );
    }
  }

  async inspectChannel(
    p: SocialPrincipal,
    accountId: string,
    target: string,
  ): Promise<SocialTelegramChannelReview> {
    const { social, now } = this.deps;
    const account = await this.channelAccount(p, accountId);
    const connectionEpoch = await social.connectionReviewEpoch(p, accountId);
    const resolved = await telegramToken(this.deps, accountId);
    if (!resolved) throw new Error("Configure the platform token on the selected host first.");
    const identity = await this.telegramChannel(resolved.token, channelTarget(target));
    if (
      !isDeepStrictEqual(account, await this.channelAccount(p, accountId)) ||
      (await telegramToken(this.deps, accountId))?.token !== resolved.token ||
      connectionEpoch !== (await social.connectionReviewEpoch(p, accountId))
    )
      throw new Error("The channel connection changed. Inspect it again.");
    if (
      (account.platformId && account.platformId !== identity.channelId) ||
      (account.telegramBotId && account.telegramBotId !== identity.botId)
    )
      throw new Error("Reconnect must preserve the channel and bot identities.");
    const review = { ...identity, reviewId: randomUUID(), expiresAt: now() + 120_000 };
    for (const [id, entry] of this.channelReviews)
      if (entry.public.expiresAt <= now() || entry.account.id === accountId)
        this.channelReviews.delete(id);
    while (this.channelReviews.size >= 100)
      this.channelReviews.delete(this.channelReviews.keys().next().value!);
    this.channelReviews.set(review.reviewId, {
      public: review,
      account: structuredClone(account),
      actorId: p.actorId,
      provider: p.provider,
      executorId: social.store.environmentId,
      tokenFingerprint: tokenFingerprint(resolved.token),
      connectionEpoch,
    });
    return structuredClone(review);
  }

  /** Bot DM connection: the vault token (or a first import from env) is verified and stored. */
  async connectBot(account: SocialAccount) {
    const { social, env, http } = this.deps;
    const resolved = await telegramToken(this.deps, account.id);
    if (!resolved) throw new Error("Configure the platform token on the selected host first.");
    const identity = await verifyTelegramBot(http, resolved.token);
    return await social.connectAccount(
      account.id,
      {
        platformId: identity.platformId,
        name: identity.name,
        scopes: identity.scopes,
        accessApproved: accessApprovedFor(resolved, account, env),
        connection: "token",
      },
      { accessToken: resolved.token },
    );
  }

  /**
   * `token` is the token the caller resolved with telegramToken(): the vault credential, or the env
   * token on a first import. The review must match it, and the same resolution must hold at commit.
   */
  async connectChannel(
    p: SocialPrincipal,
    account: SocialAccount,
    token: string,
    reviewId?: string,
  ) {
    const { social, env, now } = this.deps;
    const entry = typeof reviewId === "string" ? this.channelReviews.get(reviewId) : undefined;
    if (
      !entry ||
      entry.account.id !== account.id ||
      entry.actorId !== p.actorId ||
      entry.provider !== p.provider ||
      entry.executorId !== social.store.environmentId
    )
      throw new Error("Inspect and review this Telegram channel before connecting.");
    // Consume synchronously before the first await so concurrent confirmations cannot both use it.
    this.channelReviews.delete(reviewId!);
    if (entry.tokenFingerprint !== tokenFingerprint(token))
      throw new Error("The channel token changed. Inspect it again.");
    const imported = !(await social.credentialFor(account.id))?.accessToken;
    // Re-runs inside connectAccount too: the same token must still resolve after its own credential write.
    const guard = async () => {
      const current = await telegramToken(this.deps, account.id);
      if (
        entry.public.expiresAt <= now() ||
        !current ||
        tokenFingerprint(current.token) !== entry.tokenFingerprint ||
        !isDeepStrictEqual(entry.account, await this.channelAccount(p, account.id, true)) ||
        entry.connectionEpoch !== (await social.connectionReviewEpoch(p, account.id))
      )
        throw new Error("The channel review expired or changed. Inspect it again.");
    };
    await guard();
    const identity = await this.telegramChannel(token, entry.public.channelId);
    const { reviewId: _reviewId, expiresAt: _expiresAt, ...reviewed } = entry.public;
    if (!isDeepStrictEqual(identity, reviewed))
      throw new Error("The channel identity changed. Inspect it again.");
    await guard();
    return social.connectAccount(
      account.id,
      {
        platformId: identity.channelId,
        telegramBotId: identity.botId,
        name: identity.channelName,
        scopes: ["channel.publish"],
        accessApproved: imported
          ? env.BYCODA_SOCIAL_TELEGRAM_APPROVED === "1"
          : account.accessApproved,
        connection: "token",
      },
      { accessToken: token },
      guard,
    );
  }
}
