import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SocialHttp } from "../src/integrations/social/adapter";
import type {
  SocialAccount,
  SocialPlatform,
  SocialTelegramChannelReview,
} from "../src/features/social/model/social";
import { SOCIAL_API_ACCOUNT_TYPES } from "../src/features/social/model/social";
import type { SocialPrincipal, SocialService } from "./social";

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

/** Host configuration supplies secrets. Device RPC and session tools never receive them. */
export class SocialTokenConnections {
  private readonly channelReviews = new Map<string, ChannelReview>();
  constructor(
    private readonly social: SocialService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly http = new SocialHttp(),
    private readonly now = Date.now,
  ) {}

  private async channelAccount(p: SocialPrincipal, accountId: string, writing = false) {
    const account = await this.social.accountForBrowserManagement(p, accountId, writing);
    if (
      account.platform !== "telegram" ||
      account.accountType !== "channel" ||
      (account.connection !== undefined && account.connection !== "token")
    )
      throw new Error("Choose a Telegram channel token connection.");
    if (account.executorId !== this.social.store.environmentId)
      throw new Error("Connect the channel on its selected executor host.");
    if (account.paused) throw new Error("The social account is paused.");
    return account;
  }

  private async telegramChannel(token: string, target: string): Promise<ChannelIdentity> {
    try {
      const bot = await this.http.telegram("getMe", token);
      if (bot.is_bot !== true || !safeId(bot.id) || !username(bot.username)) throw new Error();
      const chat = await this.http.telegram("getChat", token, { chat_id: target });
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
      const member = await this.http.telegram("getChatMember", token, {
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

  async inspectTelegramChannel(
    p: SocialPrincipal,
    accountId: string,
    target: string,
  ): Promise<SocialTelegramChannelReview> {
    const account = await this.channelAccount(p, accountId);
    const connectionEpoch = await this.social.connectionReviewEpoch(p, accountId);
    const token = this.env.BYCODA_SOCIAL_TELEGRAM_TOKEN;
    if (!token) throw new Error("Configure the platform token on the selected host first.");
    const identity = await this.telegramChannel(token, channelTarget(target));
    if (
      !isDeepStrictEqual(account, await this.channelAccount(p, accountId)) ||
      this.env.BYCODA_SOCIAL_TELEGRAM_TOKEN !== token ||
      connectionEpoch !== (await this.social.connectionReviewEpoch(p, accountId))
    )
      throw new Error("The channel connection changed. Inspect it again.");
    if (
      (account.platformId && account.platformId !== identity.channelId) ||
      (account.telegramBotId && account.telegramBotId !== identity.botId)
    )
      throw new Error("Reconnect must preserve the channel and bot identities.");
    const review = { ...identity, reviewId: randomUUID(), expiresAt: this.now() + 120_000 };
    for (const [id, entry] of this.channelReviews)
      if (entry.public.expiresAt <= this.now() || entry.account.id === accountId)
        this.channelReviews.delete(id);
    while (this.channelReviews.size >= 100)
      this.channelReviews.delete(this.channelReviews.keys().next().value!);
    this.channelReviews.set(review.reviewId, {
      public: review,
      account: structuredClone(account),
      actorId: p.actorId,
      provider: p.provider,
      executorId: this.social.store.environmentId,
      tokenFingerprint: tokenFingerprint(token),
      connectionEpoch,
    });
    return structuredClone(review);
  }

  private async connectTelegramChannel(
    p: SocialPrincipal,
    account: SocialAccount,
    token: string,
    reviewId?: string,
  ) {
    const entry = typeof reviewId === "string" ? this.channelReviews.get(reviewId) : undefined;
    if (
      !entry ||
      entry.account.id !== account.id ||
      entry.actorId !== p.actorId ||
      entry.provider !== p.provider ||
      entry.executorId !== this.social.store.environmentId
    )
      throw new Error("Inspect and review this Telegram channel before connecting.");
    // Consume synchronously before the first await so concurrent confirmations cannot both use it.
    this.channelReviews.delete(reviewId!);
    const guard = async () => {
      if (
        entry.public.expiresAt <= this.now() ||
        this.env.BYCODA_SOCIAL_TELEGRAM_TOKEN !== token ||
        !isDeepStrictEqual(entry.account, await this.channelAccount(p, account.id, true)) ||
        entry.connectionEpoch !== (await this.social.connectionReviewEpoch(p, account.id))
      )
        throw new Error("The channel review expired or changed. Inspect it again.");
    };
    if (entry.tokenFingerprint !== tokenFingerprint(token))
      throw new Error("The channel token changed. Inspect it again.");
    await guard();
    const identity = await this.telegramChannel(token, entry.public.channelId);
    const { reviewId: _reviewId, expiresAt: _expiresAt, ...reviewed } = entry.public;
    if (!isDeepStrictEqual(identity, reviewed))
      throw new Error("The channel identity changed. Inspect it again.");
    await guard();
    return this.social.connectAccount(
      account.id,
      {
        platformId: identity.channelId,
        telegramBotId: identity.botId,
        name: identity.channelName,
        scopes: ["channel.publish"],
        accessApproved: this.env.BYCODA_SOCIAL_TELEGRAM_APPROVED === "1",
        connection: "token",
      },
      { accessToken: token },
      guard,
    );
  }

  availability() {
    return Object.fromEntries(
      (["whatsapp", "telegram"] as const).map((platform) => {
        const prefix = `BYCODA_SOCIAL_${platform.toUpperCase()}_`;
        const configured =
          !!this.env[`${prefix}TOKEN`] &&
          (platform === "telegram" || !!this.env[`${prefix}PHONE_NUMBER_ID`]);
        return [
          platform,
          {
            configured,
            reason: configured
              ? "Host token present; verify the identity before connecting."
              : platform === "telegram"
                ? "Configure BYCODA_SOCIAL_TELEGRAM_TOKEN on the host."
                : "Configure BYCODA_SOCIAL_WHATSAPP_TOKEN and BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID on the host.",
          },
        ];
      }),
    );
  }

  async connect(p: SocialPrincipal, accountId: string, reviewId?: string) {
    const account = await this.social.accountForOAuth(p, accountId);
    const platform: SocialPlatform = account.platform;
    if (platform !== "telegram" && platform !== "whatsapp")
      throw new Error("This platform requires OAuth.");
    if (!(SOCIAL_API_ACCOUNT_TYPES[platform] as readonly string[]).includes(account.accountType))
      throw new Error(
        "Personal accounts use a browser session. Choose a bot or business account for the host API token.",
      );
    const prefix = `BYCODA_SOCIAL_${platform.toUpperCase()}_`;
    const token = this.env[`${prefix}TOKEN`];
    if (!token) throw new Error("Configure the platform token on the selected host first.");
    if (platform === "telegram" && account.accountType === "channel")
      return this.connectTelegramChannel(p, account, token, reviewId);
    let platformId: string, name: string, scopes: string[];
    if (platform === "telegram") {
      const profile = await this.http.telegram("getMe", token);
      if (!profile.is_bot || !Number.isSafeInteger(profile.id) || !profile.username)
        throw new Error("Telegram bot identity verification failed.");
      platformId = String(profile.id);
      name = `@${profile.username}`;
      const webhook = await this.http.telegram("getWebhookInfo", token);
      scopes = ["bot.send", ...(!webhook.url ? ["bot.poll"] : [])];
    } else {
      const phone = this.env[`${prefix}PHONE_NUMBER_ID`] ?? "";
      if (!/^\d+$/.test(phone)) throw new Error("Configure a valid WhatsApp phone number ID.");
      const version = this.env.BYCODA_SOCIAL_GRAPH_VERSION ?? "v25.0";
      if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Graph API version.");
      const { value } = await this.http.request(
        `https://graph.facebook.com/${version}/${phone}?fields=id,verified_name,display_phone_number`,
        token,
      );
      if (value.id !== phone || !(value.verified_name || value.display_phone_number))
        throw new Error("WhatsApp phone identity verification failed.");
      platformId = phone;
      name = String(value.verified_name || value.display_phone_number);
      scopes = [
        "whatsapp_business_messaging",
        ...(this.env[`${prefix}CLIENT_SECRET`] && this.env[`${prefix}WEBHOOK_VERIFY_TOKEN`]
          ? ["bycoda.webhook"]
          : []),
      ];
    }
    return await this.social.connectAccount(
      accountId,
      {
        platformId,
        name,
        scopes,
        accessApproved: this.env[`${prefix}APPROVED`] === "1",
        connection: "token",
      },
      { accessToken: token },
    );
  }
}
