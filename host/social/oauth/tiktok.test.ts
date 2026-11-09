import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import type { SocialOAuthConfig, OAuthRuntime } from "./oauth-platform";
import { tiktokOAuth } from "./tiktok";

const config: SocialOAuthConfig = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  redirectUri: "https://bycoda.example/callback",
  approved: true,
  graphVersion: "v1",
  linkedinVersion: "v1",
};
const account: SocialAccount = {
  id: "a",
  platform: "tiktok",
  platformId: "creator",
  name: "Owner",
  accountType: "member",
  scopes: ["user.info.basic", "video.publish"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

function runtime(fetcher: ReturnType<typeof vi.fn>): OAuthRuntime & { config: SocialOAuthConfig } {
  return {
    config,
    fetcher: fetcher as unknown as typeof fetch,
    now: () => 1000,
    http: new SocialHttp(fetcher as unknown as typeof fetch, () => 1000),
  };
}

describe("TikTok OAuth identity", () => {
  it("stores the verified open_id and display name", async () => {
    const fetcher = vi.fn(async () =>
      json({
        data: { user: { open_id: "creator", display_name: "Owner" } },
        error: { code: "ok" },
      }),
    );
    const result = await tiktokOAuth.identity(runtime(fetcher), {
      credential: { accessToken: "token" },
      token: {},
      scopes: ["user.info.basic"],
    });
    expect(result.candidates[0]).toMatchObject({ id: "creator", name: "Owner" });
    expect(String(fetcher.mock.calls[0]![0])).toContain("user/info");
  });

  it("refuses a grant without the profile permission", async () => {
    const fetcher = vi.fn(async () =>
      json({ data: { user: { open_id: "creator" } }, error: { code: "ok" } }),
    );
    await expect(
      tiktokOAuth.identity(runtime(fetcher), {
        credential: { accessToken: "token" },
        token: {},
        scopes: ["video.publish"],
      }),
    ).rejects.toThrow("profile permission");
  });

  it("refuses a profile without an open_id instead of storing an empty identity", async () => {
    const fetcher = vi.fn(async () =>
      json({ data: { user: { display_name: "Owner" } }, error: { code: "ok" } }),
    );
    await expect(
      tiktokOAuth.identity(runtime(fetcher), {
        credential: { accessToken: "token" },
        token: {},
        scopes: ["user.info.basic"],
      }),
    ).rejects.toThrow("could not be verified");
  });
});

describe("TikTok token refresh", () => {
  const credential = { accessToken: "old", refreshToken: "refresh-old", expiresAt: 1 };

  it("rotates the refresh token and records the new expiry", async () => {
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({
        access_token: "new",
        refresh_token: "refresh-new",
        expires_in: 3600,
        scope: "user.info.basic video.publish",
      }),
    );
    const refreshed = await tiktokOAuth.refresh!(runtime(fetcher), account, credential);
    expect(refreshed).toEqual({
      accessToken: "new",
      refreshToken: "refresh-new",
      expiresAt: 1000 + 3600 * 1000,
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    const body = new URLSearchParams(String(init!.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-old");
    expect(body.get("client_key")).toBe("synthetic-client");
  });

  it("keeps the previous refresh token when TikTok does not rotate it", async () => {
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({ access_token: "new", expires_in: 60 }),
    );
    await expect(
      tiktokOAuth.refresh!(runtime(fetcher), account, credential),
    ).resolves.toMatchObject({
      refreshToken: "refresh-old",
    });
  });

  it("asks for reconnection when TikTok rejects the refresh token", async () => {
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({ error: "invalid_grant" }, 400),
    );
    await expect(tiktokOAuth.refresh!(runtime(fetcher), account, credential)).rejects.toThrow(
      "Reconnect the account",
    );
  });

  it("stops when the granted scopes differ from the account's scopes", async () => {
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({ access_token: "new", expires_in: 60, scope: "user.info.basic" }),
    );
    await expect(tiktokOAuth.refresh!(runtime(fetcher), account, credential)).rejects.toThrow(
      "scopes changed",
    );
  });

  it("requires reconnection without a refresh token and makes no request", async () => {
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => json({}));
    await expect(
      tiktokOAuth.refresh!(runtime(fetcher), account, { accessToken: "old" }),
    ).rejects.toThrow("requires owner reconnection");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
