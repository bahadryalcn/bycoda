/** Which connection methods a platform offers, and which one is the default (owner D7). */
import {
  SOCIAL_API_ACCOUNT_TYPES,
  SOCIAL_BROWSER_ACCOUNT_TYPES,
  TOKEN_PLATFORMS,
  type SocialAccount,
  type SocialPlatform,
} from "../../model/social";

export type ConnectionMethod = "api" | "browser" | "token";

/** API methods first, browser last. WhatsApp and Telegram use a token instead of OAuth. */
export function connectionMethods(platform: SocialPlatform): ConnectionMethod[] {
  const methods: ConnectionMethod[] = [];
  if ((SOCIAL_API_ACCOUNT_TYPES[platform] as readonly string[]).length)
    methods.push(TOKEN_PLATFORMS.includes(platform) ? "token" : "api");
  if ((SOCIAL_BROWSER_ACCOUNT_TYPES[platform] as readonly string[]).length) methods.push("browser");
  return methods;
}

/**
 * Owner D7: the official API is the default driver when the platform has one, the browser
 * otherwise. shortcut: the Host contract does not say which APIs are free, so "has an API
 * account type" stands in for "free API". Upgrade when the Host reports the free tier.
 */
export function defaultConnectionMethod(platform: SocialPlatform): ConnectionMethod {
  return connectionMethods(platform)[0] ?? "browser";
}

/** Account types offered for one method. */
export function accountTypesFor(
  platform: SocialPlatform,
  method: ConnectionMethod,
): readonly string[] {
  return method === "browser"
    ? (SOCIAL_BROWSER_ACCOUNT_TYPES[platform] as readonly string[])
    : (SOCIAL_API_ACCOUNT_TYPES[platform] as readonly string[]);
}

/** The `connection` value the Host's `accounts.create` expects for a method. */
export function hostConnection(
  platform: SocialPlatform,
  method: ConnectionMethod,
): NonNullable<SocialAccount["connection"]> {
  if (method === "browser") return "browser";
  return method === "token" || TOKEN_PLATFORMS.includes(platform) ? "token" : "oauth";
}

/** Whether a connection is made with a Host-held token rather than a browser or OAuth flow. */
export function isTokenAccount(account: Pick<SocialAccount, "platform">): boolean {
  return TOKEN_PLATFORMS.includes(account.platform);
}
