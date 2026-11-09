import { describe, expect, it } from "vitest";
import { SOCIAL_PLATFORMS, TOKEN_PLATFORMS } from "../../../src/features/social/model/social";
import { OAUTH_PLATFORMS, enabledOAuthPlatform } from "./registry";

describe("social OAuth platform registry", () => {
  it("defines a config for every OAuth platform and none for host token platforms", () => {
    for (const platform of SOCIAL_PLATFORMS) {
      const definition = OAUTH_PLATFORMS[platform];
      if (TOKEN_PLATFORMS.includes(platform)) {
        expect(definition).toBeUndefined();
        continue;
      }
      expect(definition, platform).toBeDefined();
      expect(definition?.platform).toBe(platform);
    }
  });

  it("enables Reddit OAuth and still excludes host token platforms", () => {
    expect(OAUTH_PLATFORMS.reddit?.enabled).toBe(true);
    expect(enabledOAuthPlatform("reddit")?.platform).toBe("reddit");
    expect(enabledOAuthPlatform("whatsapp")).toBeUndefined();
    expect(enabledOAuthPlatform("telegram")).toBeUndefined();
  });

  it("defines a refresh hook for every OAuth platform and none for token platforms", () => {
    for (const platform of [
      "x",
      "instagram",
      "facebook",
      "linkedin",
      "youtube",
      "tiktok",
      "snapchat",
      "reddit",
    ] as const)
      expect(OAUTH_PLATFORMS[platform]?.refresh, platform).toBeTypeOf("function");
    for (const platform of TOKEN_PLATFORMS)
      expect(OAUTH_PLATFORMS[platform]?.refresh, platform).toBeUndefined();
  });

  it("uses PKCE only for X and keeps authorize URLs on the provider host", () => {
    expect(OAUTH_PLATFORMS.x?.pkce).toBe(true);
    expect(OAUTH_PLATFORMS.youtube?.pkce).toBe(false);
    expect(
      new URL(
        OAUTH_PLATFORMS.youtube!.authorizeUrl({
          clientId: "id",
          redirectUri: "http://localhost/social/oauth/youtube/callback",
          approved: false,
          graphVersion: "v25.0",
          linkedinVersion: "202609",
        }),
      ).hostname,
    ).toBe("accounts.google.com");
  });
});
