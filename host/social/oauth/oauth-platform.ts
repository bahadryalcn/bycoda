import type { SocialAccount, SocialPlatform } from "../../../src/features/social/model/social";
import type { SocialHttp } from "../../../src/integrations/social/adapter";
import type { SocialCredential } from "../social-credentials";

export type SocialOAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  approved: boolean;
  graphVersion: string;
  linkedinVersion: string;
};

export type OAuthCandidate = {
  id: string;
  name: string;
  credential: SocialCredential;
  instagramAccountType?: SocialAccount["instagramAccountType"];
};

/** Fields the host reads from a token endpoint response. Requested scopes are not granted evidence. */
export type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  permissions?: string[];
  user_id?: string;
};

export type OAuthRuntime = {
  config: SocialOAuthConfig | undefined;
  fetcher: typeof fetch;
  now: () => number;
  http: SocialHttp;
};

export type OAuthIdentityInput = {
  credential: SocialCredential;
  token: OAuthTokenResponse;
  /** Scopes from the token response, before identity verification. */
  scopes: string[];
  resourceId?: string;
};

export type OAuthIdentityResult = {
  /** Replaces the flow scopes when the platform reports granted permissions separately. */
  scopes?: string[];
  candidates: OAuthCandidate[];
};

/**
 * One platform's OAuth definition. The shared flow in social-oauth.ts owns state,
 * PKCE verifier storage, callback replay protection and candidate selection; this
 * config supplies only what differs per provider.
 */
export type OAuthPlatformConfig = {
  platform: SocialPlatform;
  /** Disabled entries stay inert: begin, callback and refresh reject them. */
  enabled: boolean;
  authorizeUrl(config: SocialOAuthConfig): string;
  /** Authorization-code exchange endpoint. */
  tokenUrl(config: SocialOAuthConfig): string;
  scopeSeparator: "," | " ";
  /** Scopes this platform always adds to the operation scopes. `current` is the deduplicated list so far. */
  extraScopes(accountType: SocialAccount["accountType"], current: readonly string[]): string[];
  /** Extra query parameters on the authorize URL. */
  authorizeParams?(): Record<string, string>;
  clientIdParam: "client_id" | "client_key";
  /** `basic` sends the secret as an Authorization header; `body` sends it as client_secret. */
  tokenClientAuth: "basic" | "body";
  clientSecretRequired: boolean;
  pkce: boolean;
  /** Lifetime used when the token response omits expires_in. Absent means no expiry is recorded. */
  fallbackExpiresInSeconds?: number;
  checkResource?(accountType: SocialAccount["accountType"], resourceId: string | undefined): void;
  /** Absent means the connection requires owner reconnection. */
  refresh?(
    runtime: OAuthRuntime,
    account: SocialAccount,
    credential: SocialCredential,
  ): Promise<SocialCredential>;
  identity(
    runtime: OAuthRuntime & { config: SocialOAuthConfig },
    input: OAuthIdentityInput,
  ): Promise<OAuthIdentityResult>;
};

/**
 * Shared refresh_token grant. Platforms whose refresh hook only supplies its token
 * endpoint call this. Scope widening is rejected for every platform that uses it.
 */
export async function refreshWithRefreshToken(
  definition: Pick<OAuthPlatformConfig, "tokenUrl" | "clientIdParam" | "tokenClientAuth">,
  runtime: OAuthRuntime,
  account: SocialAccount,
  credential: SocialCredential,
): Promise<SocialCredential> {
  const config = runtime.config;
  if (!config || !credential.refreshToken)
    throw new Error("This connection requires owner reconnection.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
    [definition.clientIdParam]: config.clientId,
    ...(definition.tokenClientAuth === "body" && config.clientSecret
      ? { client_secret: config.clientSecret }
      : {}),
  });
  const response = await runtime.fetcher(definition.tokenUrl(config), {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(definition.tokenClientAuth === "basic" && config.clientSecret
        ? {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          }
        : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Account refresh failed. Reconnect the account.");
  const result = (await response.json()) as OAuthTokenResponse;
  if (!result.access_token || !Number.isFinite(result.expires_in) || Number(result.expires_in) <= 0)
    throw new Error("Account refresh returned invalid credentials.");
  if (result.scope) {
    const scopes = [...new Set(result.scope.split(/[ ,]+/).filter(Boolean))].sort();
    if (JSON.stringify(scopes) !== JSON.stringify([...account.scopes].sort()))
      throw new Error("Account scopes changed. Reconnect and review its permissions.");
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? credential.refreshToken,
    expiresAt: runtime.now() + Number(result.expires_in) * 1000,
  };
}
