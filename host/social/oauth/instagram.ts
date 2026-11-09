import type { SocialCredential } from "../social-credentials";
import type { OAuthPlatformConfig, OAuthRuntime } from "./oauth-platform";

/** Token URLs never leave the host, and provider/network errors must not echo their query secrets. */
async function instagramToken(
  runtime: OAuthRuntime,
  kind: "exchange" | "refresh",
  accessToken: string,
  clientSecret?: string,
  expectedScopes?: readonly string[],
): Promise<SocialCredential> {
  const message =
    kind === "exchange"
      ? "Instagram long-lived token exchange failed. Reconnect the account."
      : "Instagram token refresh failed. Reconnect the account.";
  if (!accessToken || (kind === "exchange" && !clientSecret)) throw new Error(message);
  try {
    const url = new URL(
      `https://graph.instagram.com/${kind === "exchange" ? "access_token" : "refresh_access_token"}`,
    );
    url.searchParams.set(
      "grant_type",
      kind === "exchange" ? "ig_exchange_token" : "ig_refresh_token",
    );
    url.searchParams.set("access_token", accessToken);
    if (kind === "exchange") url.searchParams.set("client_secret", clientSecret!);
    const response = await runtime.fetcher(url.toString(), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(message);
    const result = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
      token_type?: unknown;
      scope?: unknown;
      permissions?: unknown;
    };
    const seconds = Number(result.expires_in),
      expiresAt = runtime.now() + seconds * 1000;
    if (
      typeof result.access_token !== "string" ||
      !result.access_token ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      !Number.isSafeInteger(expiresAt) ||
      (result.token_type !== undefined && String(result.token_type).toLowerCase() !== "bearer")
    )
      throw new Error(message);
    const returnedScopes =
      typeof result.scope === "string"
        ? result.scope.split(/[ ,]+/).filter(Boolean)
        : Array.isArray(result.permissions) &&
            result.permissions.every((scope) => typeof scope === "string")
          ? (result.permissions as string[])
          : undefined;
    if (
      expectedScopes &&
      (result.scope !== undefined || result.permissions !== undefined) &&
      (!returnedScopes ||
        JSON.stringify([...new Set(returnedScopes)].sort()) !==
          JSON.stringify([...new Set(expectedScopes)].sort()))
    )
      throw new Error(message);
    return { accessToken: result.access_token, expiresAt };
  } catch {
    throw new Error(message);
  }
}

export const instagramOAuth: OAuthPlatformConfig = {
  platform: "instagram",
  enabled: true,
  authorizeUrl: () => "https://www.instagram.com/oauth/authorize",
  tokenUrl: () => "https://api.instagram.com/oauth/access_token",
  scopeSeparator: ",",
  extraScopes: () => ["instagram_business_basic"],
  clientIdParam: "client_id",
  tokenClientAuth: "body",
  clientSecretRequired: true,
  pkce: false,
  async refresh(runtime, account, credential) {
    if (
      !runtime.config ||
      !credential.accessToken ||
      !account.scopes.includes("instagram_business_basic") ||
      credential.expiresAt === undefined ||
      credential.expiresAt <= runtime.now()
    )
      throw new Error(
        "Instagram connection expired or is missing permission. Reconnect the account.",
      );
    // Instagram Login renews its unexpired long-lived access token; it does not issue a separate refresh token.
    return instagramToken(runtime, "refresh", credential.accessToken, undefined, account.scopes);
  },
  async identity(runtime, { credential, token, scopes }) {
    const { config, http } = runtime;
    Object.assign(
      credential,
      await instagramToken(
        runtime,
        "exchange",
        credential.accessToken,
        config.clientSecret,
        scopes,
      ),
    );
    delete credential.refreshToken;
    const { value } = await http.request(
      `https://graph.instagram.com/${config.graphVersion}/me?fields=user_id,username,account_type`,
      credential.accessToken,
    );
    if (
      value.account_type !== undefined &&
      !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(value.account_type)
    )
      throw new Error("Instagram requires a professional account.");
    if (
      token.user_id !== undefined &&
      String(token.user_id) !== String(value.user_id ?? value.id ?? "")
    )
      throw new Error("Instagram OAuth identity changed during token exchange.");
    return {
      candidates: [
        {
          id: String(value.user_id ?? value.id ?? ""),
          name: String(value.username ?? ""),
          instagramAccountType: value.account_type,
          credential,
        },
      ],
    };
  },
};
