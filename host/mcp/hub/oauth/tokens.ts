import { createHash, randomBytes } from "node:crypto";
import type { AuthServer } from "./discovery";
import { oauthFetch, parseJsonObject, type OAuthFetch } from "./net";

export type OAuthClient = { clientId: string; clientSecret?: string };
export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt: number };

const CLIENT_NAME = "bycoda";
const DEFAULT_LIFETIME_S = 3600;
const MAX_LIFETIME_S = 30 * 24 * 3600;
const MAX_TOKEN_CHARS = 16 * 1024;

/** The server rejected the credential itself, as opposed to being unreachable. */
export class OAuthRejectedError extends Error {}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const form = (values: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ).toString();

const str = (value: unknown, max = 2048) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;

/** RFC 7591 dynamic client registration for one loopback redirect URI. */
export async function registerClient(
  doFetch: OAuthFetch,
  server: AuthServer,
  redirectUri: string,
): Promise<OAuthClient> {
  if (!server.registrationEndpoint)
    throw new Error("This server needs a pre-registered client, which is not supported.");
  const response = await oauthFetch(doFetch, server.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body =
    response.status === 200 || response.status === 201 ? parseJsonObject(response.text) : {};
  const clientId = str(body.client_id);
  if (!clientId) throw new Error("Client registration was refused.");
  return { clientId, clientSecret: str(body.client_secret) };
}

export function authorizationUrl(input: {
  server: AuthServer;
  client: OAuthClient;
  redirectUri: string;
  state: string;
  challenge: string;
  resource: string;
}): string {
  const url = new URL(input.server.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);
  return url.href;
}

function readTokens(body: Record<string, unknown>, now: number, previous?: string): OAuthTokens {
  const accessToken = str(body.access_token, MAX_TOKEN_CHARS);
  if (!accessToken || String(body.token_type ?? "").toLowerCase() !== "bearer")
    throw new Error("Sign-in response was not understood.");
  const lifetime =
    typeof body.expires_in === "number" && body.expires_in > 0
      ? Math.min(body.expires_in, MAX_LIFETIME_S)
      : DEFAULT_LIFETIME_S;
  // Rotation: a new refresh token replaces the old one; absent means the old one stays valid.
  const refreshToken = str(body.refresh_token, MAX_TOKEN_CHARS) ?? previous;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: now + lifetime * 1000,
  };
}

async function tokenRequest(
  doFetch: OAuthFetch,
  server: AuthServer,
  client: OAuthClient,
  values: Record<string, string | undefined>,
) {
  const response = await oauthFetch(doFetch, server.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form({ ...values, client_id: client.clientId, client_secret: client.clientSecret }),
  });
  if (response.status === 200) return parseJsonObject(response.text);
  if (response.status === 400 || response.status === 401)
    throw new OAuthRejectedError("Sign-in was rejected.");
  throw new Error("Sign-in server error.");
}

export async function exchangeCode(
  doFetch: OAuthFetch,
  input: {
    server: AuthServer;
    client: OAuthClient;
    code: string;
    verifier: string;
    redirectUri: string;
    resource: string;
    now: number;
  },
): Promise<OAuthTokens> {
  const body = await tokenRequest(doFetch, input.server, input.client, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    resource: input.resource,
  });
  return readTokens(body, input.now);
}

export async function refreshTokens(
  doFetch: OAuthFetch,
  input: {
    server: AuthServer;
    client: OAuthClient;
    refreshToken: string;
    resource: string;
    now: number;
  },
): Promise<OAuthTokens> {
  const body = await tokenRequest(doFetch, input.server, input.client, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    resource: input.resource,
  });
  return readTokens(body, input.now, input.refreshToken);
}

/** RFC 7009, best effort: sign-out succeeds locally even when the server cannot be reached. */
export async function revokeToken(
  doFetch: OAuthFetch,
  input: { revocationEndpoint?: string; client: OAuthClient; token: string; hint: string },
): Promise<void> {
  if (!input.revocationEndpoint) return;
  await oauthFetch(doFetch, input.revocationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      token: input.token,
      token_type_hint: input.hint,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
    }),
  }).catch(() => undefined);
}
