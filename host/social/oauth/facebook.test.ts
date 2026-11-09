import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { facebookOAuth } from "./facebook";
import type { OAuthRuntime } from "./oauth-platform";

const config = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://host.test/social/oauth/facebook/callback",
  approved: true,
  graphVersion: "v25.0",
  linkedinVersion: "202601",
};

const account: SocialAccount = {
  id: "account",
  platform: "facebook",
  platformId: "111",
  name: "Page",
  accountType: "page",
  scopes: ["pages_manage_posts"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
};

function runtimeWith(fetcher: typeof fetch): OAuthRuntime {
  return { config, fetcher, now: () => 1_000, http: new SocialHttp(fetcher) };
}

describe("Facebook OAuth refresh (fb_exchange_token)", () => {
  it("returns the long-lived token when /me is still the connected Page", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname.endsWith("/oauth/access_token"))
        return Response.json({ access_token: "synthetic-long", expires_in: 5_184_000 });
      return Response.json({ id: "111" });
    }) as unknown as typeof fetch;
    const next = await facebookOAuth.refresh!(runtimeWith(fetcher), account, {
      accessToken: "synthetic-page",
    });
    expect(next).toEqual({ accessToken: "synthetic-long", expiresAt: 1_000 + 5_184_000 * 1000 });
    const exchange = new URL(
      String((fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]),
    );
    expect(exchange.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(exchange.searchParams.get("fb_exchange_token")).toBe("synthetic-page");
  });

  it("rejects a refreshed token whose /me is a different identity (user token instead of Page)", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname.endsWith("/oauth/access_token"))
        return Response.json({ access_token: "synthetic-user", expires_in: 5_184_000 });
      return Response.json({ id: "999" });
    }) as unknown as typeof fetch;
    await expect(
      facebookOAuth.refresh!(runtimeWith(fetcher), account, { accessToken: "synthetic-page" }),
    ).rejects.toThrow("changed the Page identity");
  });

  it("fails with a generic message that never echoes the token", async () => {
    const fetcher = vi.fn(
      async () => new Response('{"error":"synthetic-page"}', { status: 400 }),
    ) as unknown as typeof fetch;
    const error = await facebookOAuth.refresh!(runtimeWith(fetcher), account, {
      accessToken: "synthetic-page",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Facebook long-lived token exchange failed. Reconnect the account.",
    );
  });
});
