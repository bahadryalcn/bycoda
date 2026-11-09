import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { enabledOAuthPlatform } from "./registry";
import type { OAuthRuntime } from "./oauth-platform";

const config = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  redirectUri: "https://host.test/callback",
  approved: true,
  graphVersion: "v1",
  linkedinVersion: "202609",
};
const account = {
  platform: "linkedin",
  scopes: ["openid", "profile", "w_member_social"],
} as unknown as SocialAccount;
const runtime = (fetcher: typeof fetch): OAuthRuntime =>
  ({ config, fetcher, now: () => 1_000, http: {} }) as unknown as OAuthRuntime;
const refresh = (
  fetcher: typeof fetch,
  credential: { accessToken: string; refreshToken?: string; expiresAt?: number },
) => {
  const definition = enabledOAuthPlatform("linkedin");
  return definition!.refresh!(runtime(fetcher), account, credential as never);
};

describe("LinkedIn token refresh", () => {
  it("is registered for LinkedIn accounts", () => {
    expect(enabledOAuthPlatform("linkedin")?.refresh).toBeTypeOf("function");
  });

  it("requires owner reconnection when no refresh token was issued", async () => {
    const fetcher = vi.fn();
    await expect(refresh(fetcher as never, { accessToken: "old" })).rejects.toThrow(
      "requires owner reconnection",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("exchanges the refresh token at LinkedIn's token endpoint and returns the rotated credential", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
    );
    const credential = await refresh(fetcher as never, {
      accessToken: "old",
      refreshToken: "old-refresh",
    });
    expect(credential).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 1_000 + 3_600_000,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    expect(String(init.body)).toContain("grant_type=refresh_token");
  });

  it("rejects a response without a usable lifetime", async () => {
    const fetcher = vi.fn(async () => Response.json({ access_token: "new-access" }));
    await expect(
      refresh(fetcher as never, { accessToken: "old", refreshToken: "old-refresh" }),
    ).rejects.toThrow("invalid credentials");
  });

  it("rejects a refresh that widens or changes the granted scopes", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        access_token: "new-access",
        expires_in: 3600,
        scope: "openid profile w_member_social w_organization_social",
      }),
    );
    await expect(
      refresh(fetcher as never, { accessToken: "old", refreshToken: "old-refresh" }),
    ).rejects.toThrow("Account scopes changed");
  });
});
