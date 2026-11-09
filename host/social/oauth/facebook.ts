import type { SocialCredential } from "../social-credentials";
import type { OAuthPlatformConfig, OAuthRuntime } from "./oauth-platform";

const EXCHANGE_FAILED = "Facebook long-lived token exchange failed. Reconnect the account.";

/**
 * Exchanges a short-lived Facebook token for a long-lived one (fb_exchange_token). Page tokens derived
 * from the result carry its lifetime. Errors never echo the token, client secret or provider body.
 */
async function facebookLongLived(runtime: OAuthRuntime, token: string): Promise<SocialCredential> {
  const config = runtime.config;
  if (!config?.clientSecret || !token) throw new Error(EXCHANGE_FAILED);
  try {
    const url = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("client_secret", config.clientSecret);
    url.searchParams.set("fb_exchange_token", token);
    const response = await runtime.fetcher(url.toString(), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(EXCHANGE_FAILED);
    const result = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    const seconds = Number(result.expires_in);
    if (
      typeof result.access_token !== "string" ||
      !result.access_token ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    )
      throw new Error(EXCHANGE_FAILED);
    return { accessToken: result.access_token, expiresAt: runtime.now() + seconds * 1000 };
  } catch {
    throw new Error(EXCHANGE_FAILED);
  }
}

export const facebookOAuth: OAuthPlatformConfig = {
  platform: "facebook",
  enabled: true,
  authorizeUrl: (config) => `https://www.facebook.com/${config.graphVersion}/dialog/oauth`,
  tokenUrl: (config) => `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
  scopeSeparator: ",",
  extraScopes: () => ["pages_show_list"],
  clientIdParam: "client_id",
  tokenClientAuth: "body",
  clientSecretRequired: true,
  pkce: false,
  /**
   * shortcut: unverified that Meta returns a long-lived Page token from fb_exchange_token; the identity
   * check below rejects the result unless `/me` is still the connected Page. Otherwise the owner reconnects.
   */
  async refresh(runtime, account, credential) {
    const next = await facebookLongLived(runtime, credential.accessToken);
    const version = runtime.config?.graphVersion;
    if (!version) throw new Error(EXCHANGE_FAILED);
    const { value } = await runtime.http.request(
      `https://graph.facebook.com/${version}/me?fields=id`,
      next.accessToken,
    );
    if (String(value.id ?? "") !== account.platformId)
      throw new Error("Facebook token refresh changed the Page identity. Reconnect the account.");
    return next;
  },
  async identity(runtime, { credential }) {
    const { config, http } = runtime;
    // Page tokens derived from a short-lived user token expire quickly; derive them from the long-lived one.
    const user = await facebookLongLived(runtime, credential.accessToken);
    // Granted permissions replace the requested scopes; page tokens do not inherit the refresh token.
    const granted = await http.request(
      `https://graph.facebook.com/${config.graphVersion}/me/permissions`,
      user.accessToken,
    );
    const scopes: string[] = (granted.value.data ?? [])
      .filter((item: { status: string }) => item.status === "granted")
      .map((item: { permission: string }) => item.permission);
    const { value } = await http.request(
      `https://graph.facebook.com/${config.graphVersion}/me/accounts?fields=id,name,access_token,tasks&limit=100`,
      user.accessToken,
    );
    const candidates = (value.data ?? [])
      .filter(
        (page: { access_token?: string; tasks?: string[] }) =>
          page.access_token &&
          page.tasks?.some((task) =>
            ["CREATE_CONTENT", "MANAGE", "MODERATE", "MESSAGING"].includes(task),
          ),
      )
      .map((page: { id: string; name: string; access_token: string }) => ({
        id: page.id,
        name: page.name,
        credential: {
          ...user,
          accessToken: page.access_token,
          refreshToken: undefined,
        },
      }));
    return { scopes, candidates };
  },
};
