import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { enabledOAuthPlatform } from "./registry";
import type { OAuthRuntime } from "./oauth-platform";
import { isPermanentRefreshFailure, SocialRefreshError } from "./refresh-error";

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

  it.each([
    [400, { error: "invalid_grant", error_description: "fake-refresh-secret" }, "permanent"],
    [401, { error: "invalid_grant" }, "permanent"],
    [400, { error: "invalid_request" }, "transient"],
    [401, { error: "invalid_client" }, "transient"],
    [500, { error: "invalid_grant" }, "transient"],
    [503, { error: "temporarily_unavailable" }, "transient"],
  ] as const)(
    "classifies a %s refresh rejection %j as %s without echoing the body",
    async (status, body, kind) => {
      const fetcher = vi.fn(async () => Response.json(body, { status }));
      const failure = await refresh(fetcher as never, {
        accessToken: "fake-access",
        refreshToken: "fake-refresh",
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SocialRefreshError);
      expect((failure as SocialRefreshError).kind).toBe(kind);
      expect((failure as SocialRefreshError).message).not.toMatch(/fake-/);
    },
  );

  it("treats an unreadable rejection body and a network failure as transient", async () => {
    const unreadable = await refresh(
      vi.fn(async () => new Response("<html>gateway</html>", { status: 400 })) as never,
      { accessToken: "fake-access", refreshToken: "fake-refresh" },
    ).catch((error: unknown) => error);
    expect(unreadable).toBeInstanceOf(SocialRefreshError);
    expect(isPermanentRefreshFailure(unreadable)).toBe(false);
    const offline = await refresh(
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as never,
      { accessToken: "fake-access", refreshToken: "fake-refresh" },
    ).catch((error: unknown) => error);
    expect(isPermanentRefreshFailure(offline)).toBe(false);
  });

  it("marks a missing refresh token and changed scopes as permanent", async () => {
    const missing = await refresh(vi.fn() as never, { accessToken: "fake-access" }).catch(
      (error: unknown) => error,
    );
    expect(isPermanentRefreshFailure(missing)).toBe(true);
    const widened = await refresh(
      vi.fn(async () =>
        Response.json({ access_token: "fake-new", expires_in: 3600, scope: "openid email" }),
      ) as never,
      { accessToken: "fake-access", refreshToken: "fake-refresh" },
    ).catch((error: unknown) => error);
    expect(isPermanentRefreshFailure(widened)).toBe(true);
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
