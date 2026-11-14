import { oauthFetch, parseJsonObject, safeUrl, type OAuthFetch } from "./net";

export type AuthServer = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
};
export type Discovery = { resource: string; authServer: AuthServer };

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bycoda-mcp-oauth", version: "1" },
  },
});

/** RFC 8707 canonical resource: lowercase scheme and host, no query or fragment. */
export function canonicalResource(serverUrl: string): string {
  const url = safeUrl(serverUrl);
  url.search = "";
  return url.pathname === "/" ? url.href.replace(/\/$/, "") : url.href;
}

/** `resource_metadata` from a `WWW-Authenticate: Bearer ...` challenge. */
export function resourceMetadataFrom(header: string | null): string | undefined {
  return /resource_metadata="([^"]{1,2048})"/i.exec(header ?? "")?.[1];
}

const wellKnown = (url: URL, suffix: string) =>
  `${url.origin}/.well-known/${suffix}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;

async function getJson(doFetch: OAuthFetch, url: string) {
  const response = await oauthFetch(doFetch, url, { headers: { Accept: "application/json" } });
  return response.status === 200 ? parseJsonObject(response.text) : undefined;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const endpoint = (value: unknown) => {
  const raw = text(value);
  return raw ? safeUrl(raw).href : undefined;
};

/** RFC 9728 protected-resource metadata, then RFC 8414 / OIDC authorization-server metadata. */
export async function discover(doFetch: OAuthFetch, serverUrl: string): Promise<Discovery> {
  const server = safeUrl(serverUrl);
  const resource = canonicalResource(serverUrl);
  const probe = await oauthFetch(doFetch, serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: INIT_BODY,
  });
  const header =
    probe.status === 401 ? resourceMetadataFrom(probe.headers.get("www-authenticate")) : undefined;
  const candidates = [
    ...(header ? [safeUrl(header).href] : []),
    wellKnown(server, "oauth-protected-resource"),
    `${server.origin}/.well-known/oauth-protected-resource`,
  ];
  let issuerUrl = server.origin;
  for (const candidate of new Set(candidates)) {
    const prm = await getJson(doFetch, candidate).catch(() => undefined);
    if (!prm) continue;
    // The metadata must describe this server, otherwise it could redirect trust elsewhere.
    const described = text(prm.resource);
    if (described && safeUrl(described).origin !== server.origin)
      throw new Error("Sign-in metadata does not match this server.");
    const first = Array.isArray(prm.authorization_servers)
      ? text(prm.authorization_servers[0])
      : undefined;
    if (first) issuerUrl = safeUrl(first).href.replace(/\/$/, "");
    break;
  }
  const issuer = safeUrl(issuerUrl);
  const candidatesAs = [
    wellKnown(issuer, "oauth-authorization-server"),
    wellKnown(issuer, "openid-configuration"),
    `${issuer.href.replace(/\/$/, "")}/.well-known/openid-configuration`,
  ];
  for (const candidate of new Set(candidatesAs)) {
    const meta = await getJson(doFetch, candidate).catch(() => undefined);
    if (!meta) continue;
    if (text(meta.issuer)?.replace(/\/$/, "") !== issuerUrl)
      throw new Error("Sign-in metadata does not match this server.");
    const methods = meta.code_challenge_methods_supported;
    if (Array.isArray(methods) && !methods.includes("S256"))
      throw new Error("This server does not support secure sign-in.");
    const authorizationEndpoint = endpoint(meta.authorization_endpoint);
    const tokenEndpoint = endpoint(meta.token_endpoint);
    if (!authorizationEndpoint || !tokenEndpoint)
      throw new Error("Sign-in metadata is incomplete.");
    return {
      resource,
      authServer: {
        issuer: issuerUrl,
        authorizationEndpoint,
        tokenEndpoint,
        registrationEndpoint: endpoint(meta.registration_endpoint),
        revocationEndpoint: endpoint(meta.revocation_endpoint),
      },
    };
  }
  throw new Error("Could not discover sign-in for this server.");
}
