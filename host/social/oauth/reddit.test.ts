import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import type { SocialHttp } from "../../../src/integrations/social/adapter";
import { REDDIT_USER_AGENT } from "../../../src/integrations/social/adapters/reddit-api";
import type { OAuthRuntime } from "./oauth-platform";
import { redditOAuth } from "./reddit";

const SCOPES = ["identity", "submit", "read", "privatemessages", "history", "edit"];

const config = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "http://localhost/social/oauth/reddit/callback",
  approved: false,
  graphVersion: "v25.0",
  linkedinVersion: "202609",
};

const account = { id: "a", platform: "reddit", scopes: SCOPES } as unknown as SocialAccount;

describe("Reddit OAuth definition", () => {
  it("requests a permanent duration so a refresh token is issued", () => {
    expect(redditOAuth.enabled).toBe(true);
    expect(redditOAuth.authorizeParams?.()).toEqual({ duration: "permanent" });
    expect(redditOAuth.extraScopes("member", [])).toEqual(SCOPES);
    expect(new URL(redditOAuth.authorizeUrl(config)).hostname).toBe("www.reddit.com");
  });

  it("verifies the identity from /api/v1/me with the reddit user agent", async () => {
    const request = vi.fn(async () => ({
      value: { name: "owner", id: "abc123" },
      headers: new Headers(),
    }));
    const http = { request } as unknown as SocialHttp;
    const result = await redditOAuth.identity(
      { config, http, fetcher: fetch, now: () => 0 } as OAuthRuntime & { config: typeof config },
      { credential: { accessToken: "tok" } as never, token: {}, scopes: SCOPES },
    );
    expect(request).toHaveBeenCalledWith("https://oauth.reddit.com/api/v1/me", "tok", {
      headers: { "User-Agent": REDDIT_USER_AGENT },
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({ id: "t2_abc123", name: "u/owner" }),
    ]);
  });

  it("sends the user agent on the refresh_token grant", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: "new", expires_in: 3600, scope: SCOPES.join(" ") }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const runtime = { config, fetcher, now: () => 1_000, http: {} as SocialHttp } as OAuthRuntime;
    const credential = await redditOAuth.refresh!(runtime, account, {
      accessToken: "old",
      refreshToken: "refresh",
    } as never);
    expect(credential.accessToken).toBe("new");
    expect(credential.refreshToken).toBe("refresh");
    const init = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(REDDIT_USER_AGENT);
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });
});
