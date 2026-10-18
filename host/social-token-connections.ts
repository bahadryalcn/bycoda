import { SocialHttp } from "../src/integrations/social/adapter";
import type { SocialPlatform } from "../src/features/social/model/social";
import type { SocialPrincipal, SocialService } from "./social";

/** Host configuration supplies secrets. Device RPC and session tools never receive them. */
export class SocialTokenConnections {
  constructor(
    private readonly social: SocialService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly http = new SocialHttp(),
  ) {}

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

  async connect(p: SocialPrincipal, accountId: string) {
    const account = this.social.accountForOAuth(p, accountId);
    const platform: SocialPlatform = account.platform;
    if (platform !== "telegram" && platform !== "whatsapp")
      throw new Error("This platform requires OAuth.");
    const prefix = `BYCODA_SOCIAL_${platform.toUpperCase()}_`;
    const token = this.env[`${prefix}TOKEN`];
    if (!token) throw new Error("Configure the platform token on the selected host first.");
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
    return this.social.connectAccount(
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
