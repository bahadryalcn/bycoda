import { SocialHttp } from "../../src/integrations/social/adapter";
import type {
  SocialPlatform,
  SocialTelegramChannelReview,
} from "../../src/features/social/model/social";
import { SOCIAL_API_ACCOUNT_TYPES } from "../../src/features/social/model/social";
import type { SocialPrincipal, SocialService } from "./social";
import {
  TelegramChannelConnections,
  telegramAvailability,
  telegramToken,
} from "./token-connections/telegram";
import { verifyWhatsAppBusiness, whatsappAvailability } from "./token-connections/whatsapp";

/** Host configuration supplies secrets. Device RPC and session tools never receive them. */
export class SocialTokenConnections {
  private readonly telegram: TelegramChannelConnections;
  constructor(
    private readonly social: SocialService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly http = new SocialHttp(),
    private readonly now = Date.now,
  ) {
    this.telegram = new TelegramChannelConnections({ social, env, http, now });
  }

  async inspectTelegramChannel(
    p: SocialPrincipal,
    accountId: string,
    target: string,
  ): Promise<SocialTelegramChannelReview> {
    return await this.telegram.inspectChannel(p, accountId, target);
  }

  availability() {
    return {
      whatsapp: whatsappAvailability(this.env),
      telegram: telegramAvailability(this.env),
    };
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
    // Telegram resolves the stored vault token first and imports the env token only on a first connect.
    if (platform === "telegram") {
      if (account.accountType !== "channel") return await this.telegram.connectBot(account);
      const resolved = await telegramToken(
        { social: this.social, env: this.env, http: this.http, now: this.now },
        account.id,
      );
      if (!resolved) throw new Error("Configure the platform token on the selected host first.");
      return this.telegram.connectChannel(p, account, resolved.token, reviewId);
    }
    const prefix = `BYCODA_SOCIAL_${platform.toUpperCase()}_`;
    const token = this.env[`${prefix}TOKEN`];
    if (!token) throw new Error("Configure the platform token on the selected host first.");
    const identity = await verifyWhatsAppBusiness(this.env, this.http, token);
    return await this.social.connectAccount(
      accountId,
      {
        platformId: identity.platformId,
        name: identity.name,
        scopes: identity.scopes,
        accessApproved: this.env[`${prefix}APPROVED`] === "1",
        connection: "token",
      },
      { accessToken: token },
    );
  }
}
