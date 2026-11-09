import { REDDIT_USER_AGENT } from "../../../src/integrations/social/adapters/reddit-api";
import {
  refreshWithRefreshToken,
  type OAuthPlatformConfig,
  type OAuthRuntime,
} from "./oauth-platform";

/** Adds the Reddit User-Agent to every token-endpoint call made by the shared refresh grant. */
function withUserAgent(runtime: OAuthRuntime): OAuthRuntime {
  return {
    ...runtime,
    fetcher: (input, init = {}) =>
      runtime.fetcher(input, {
        ...init,
        headers: { "User-Agent": REDDIT_USER_AGENT, ...(init.headers as Record<string, string>) },
      }),
  };
}

/**
 * Reddit OAuth web app with duration=permanent, so the token response includes a refresh_token.
 * Access tokens last one hour (Reddit OAuth2 wiki). Token endpoint, authorize parameters and the
 * Basic client authentication are verified against the wiki only; the live developer page was not reachable.
 */
export const redditOAuth: OAuthPlatformConfig = {
  platform: "reddit",
  enabled: true,
  authorizeUrl: () => "https://www.reddit.com/api/v1/authorize",
  tokenUrl: () => "https://www.reddit.com/api/v1/access_token",
  scopeSeparator: " ",
  extraScopes: () => ["identity", "submit", "read", "privatemessages", "history", "edit"],
  authorizeParams: () => ({ duration: "permanent" }),
  clientIdParam: "client_id",
  tokenClientAuth: "basic", // unverified: Basic auth for web apps is not stated on the wiki page read
  clientSecretRequired: true,
  pkce: false, // unverified
  fallbackExpiresInSeconds: 3600,
  // shortcut: the scope set on refresh is compared with the account's stored scopes; Reddit's refresh
  // response scope field is not verified live.
  refresh: (runtime, account, credential) =>
    refreshWithRefreshToken(redditOAuth, withUserAgent(runtime), account, credential),
  async identity({ http }, { credential }) {
    const { value } = await http.request(
      "https://oauth.reddit.com/api/v1/me",
      credential.accessToken,
      { headers: { "User-Agent": REDDIT_USER_AGENT } },
    );
    const name = typeof value.name === "string" ? value.name : "";
    const id = typeof value.id === "string" ? value.id : "";
    if (!name || !id) throw new Error("Reddit account identity was not returned.");
    return {
      candidates: [
        {
          // shortcut: `t2_` prefix assumed for the stable account id; the response id format is not verified live.
          id: id.startsWith("t2_") ? id : `t2_${id}`,
          name: `u/${name}`,
          credential,
        },
      ],
    };
  },
};
