import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SocialOAuth, socialOAuthConfigs } from "./social-oauth";
import { SocialService } from "./social";
import { SocialTokenConnections } from "./social-token-connections";
import { SocialHttp } from "../src/integrations/social/adapter";
import { SOCIAL_ACCOUNT_TYPES } from "../src/features/social/model/social";
import { HostStore } from "./store";
import type { SocialCredential } from "./social-credentials";
import type { SocialAdapters } from "../src/integrations/social/adapter";
import type { SocialAccount, SocialPlatform } from "../src/features/social/model/social";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const owner = { kind: "owner", actorId: "device", provider: "owner" } as const;
async function fixture(platform: SocialPlatform = "x") {
  const path = mkdtempSync(join(tmpdir(), "social-oauth-"));
  const store = new HostStore(join(path, "host.db"));
  const project = await store.addProject(path, "Project");
  const tokens = new Map<string, SocialCredential>();
  const vault = {
    get: async (id: string) => tokens.get(id),
    set: async (id: string, c: SocialCredential) => {
      tokens.set(id, c);
    },
    delete: async (id: string) => {
      tokens.delete(id);
    },
  };
  const social = new SocialService(store, vault, {} as SocialAdapters, path);
  cleanup.push(async () => {
    await social.dispose();
    await store.close();
    rmSync(path, { recursive: true, force: true });
  });
  const account = (await social.call(owner, "accounts.create", {
    platform,
    name: "Pending",
    accountType: SOCIAL_ACCOUNT_TYPES[platform][0],
    projectIds: [project.id],
  })) as SocialAccount;
  const config = {
    clientId: "synthetic-client",
    clientSecret: "synthetic-client-secret",
    redirectUri: `http://localhost/social/oauth/${platform}/callback`,
    approved: true,
    graphVersion: "v25.0",
    linkedinVersion: "202609",
  };
  return { social, account, tokens, config };
}
describe("Sosyal OAuth güven sınırı", () => {
  it.each(["tiktok", "snapchat"] as const)(
    "connects %s only after verified identity and explicit selection",
    async (platform) => {
      const s = await fixture(platform);
      const scope =
        platform === "tiktok" ? "user.info.basic,video.publish" : "snapchat-profile-api";
      const fetcher = vi.fn(async (raw: unknown, options?: RequestInit) => {
        const url = String(raw);
        if (url.includes("token")) {
          const body = options!.body as URLSearchParams;
          expect(body.get(platform === "tiktok" ? "client_key" : "client_id")).toBe(
            "synthetic-client",
          );
          return Response.json({
            access_token: "secret",
            refresh_token: "refresh",
            expires_in: 3600,
            scope,
          });
        }
        return Response.json(
          platform === "tiktok"
            ? {
                data: { user: { open_id: "profile-1", display_name: "Creator" } },
                error: { code: "ok" },
              }
            : { public_profile: { id: "profile-1", display_name: "Creator" } },
        );
      });
      const oauth = new SocialOAuth(s.social, { [platform]: s.config }, fetcher);
      const auth = new URL((await oauth.begin(owner, s.account.id)).url);
      expect(auth.searchParams.get("scope")).toBe(scope);
      await oauth.callback(
        platform,
        new URLSearchParams({ state: auth.searchParams.get("state")!, code: "code" }),
      );
      expect(s.tokens.size).toBe(0);
      expect((await oauth.status(owner, s.account.id)).candidates).toEqual([
        { id: "profile-1", name: "Creator" },
      ]);
      const connected = await oauth.select(owner, s.account.id, "profile-1");
      expect(connected).toMatchObject({
        connected: true,
        platformId: "profile-1",
        scopes: scope.split(","),
      });
      expect(JSON.stringify(connected)).not.toContain("secret");
      await expect(
        oauth.callback(
          platform,
          new URLSearchParams({ state: auth.searchParams.get("state")!, code: "code" }),
        ),
      ).rejects.toThrow("state");
    },
  );
  it("verifies a host-configured Telegram bot, keeps its existing webhook, and denies session administration", async () => {
    const s = await fixture("telegram");
    const fetcher = vi.fn(async (raw: unknown) =>
      Response.json({
        ok: true,
        result: String(raw).endsWith("getMe")
          ? { id: 123, is_bot: true, username: "owner_bot" }
          : { url: "https://other-app.test/webhook" },
      }),
    );
    const connections = new SocialTokenConnections(
      s.social,
      { BYCODA_SOCIAL_TELEGRAM_TOKEN: "123:secret", BYCODA_SOCIAL_TELEGRAM_APPROVED: "1" },
      new SocialHttp(fetcher),
    );
    expect(connections.availability().telegram.configured).toBe(true);
    const connected = await connections.connect(owner, s.account.id);
    expect(connected).toMatchObject({
      name: "@owner_bot",
      platformId: "123",
      connection: "token",
      scopes: ["bot.send"],
    });
    expect(s.tokens.get(s.account.id)?.accessToken).toBe("123:secret");
    await expect(
      connections.connect({ ...owner, kind: "session" } as never, s.account.id),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("verifies the configured WhatsApp phone identity and withholds webhook capabilities without receiver configuration", async () => {
    const s = await fixture("whatsapp");
    const connections = new SocialTokenConnections(
      s.social,
      {
        BYCODA_SOCIAL_WHATSAPP_TOKEN: "secret",
        BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID: "123",
        BYCODA_SOCIAL_WHATSAPP_APPROVED: "1",
      },
      new SocialHttp(async () => Response.json({ id: "123", verified_name: "Business" })),
    );
    expect(await connections.connect(owner, s.account.id)).toMatchObject({
      name: "Business",
      platformId: "123",
      scopes: ["whatsapp_business_messaging"],
    });
    const wrong = new SocialTokenConnections(
      s.social,
      {
        BYCODA_SOCIAL_WHATSAPP_TOKEN: "other-secret",
        BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID: "456",
      },
      new SocialHttp(async () => Response.json({ id: "123", verified_name: "Business" })),
    );
    await expect(wrong.connect(owner, s.account.id)).rejects.toThrow("identity");
    expect(s.tokens.get(s.account.id)?.accessToken).toBe("secret");
  });
  it.each(["x", "youtube"] as const)(
    "refreshes %s tokens without widening account scopes",
    async (platform) => {
      const s = await fixture(platform);
      s.account.scopes = ["existing-scope"];
      const fetcher = vi.fn(async () =>
        Response.json({
          access_token: "rotated-test-token",
          refresh_token: "rotated-test-refresh",
          expires_in: 3600,
          scope: "existing-scope",
        }),
      );
      const oauth = new SocialOAuth(s.social, { [platform]: s.config }, fetcher, () => 1000);
      expect(
        await oauth.refresh(s.account, {
          accessToken: "old-test",
          refreshToken: "refresh-test",
          expiresAt: 0,
        }),
      ).toEqual({
        accessToken: "rotated-test-token",
        refreshToken: "rotated-test-refresh",
        expiresAt: 3601000,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockResolvedValue(
        Response.json({ access_token: "test", expires_in: 3600, scope: "unexpected-scope" }),
      );
      await expect(
        oauth.refresh(s.account, { accessToken: "old", refreshToken: "refresh" }),
      ).rejects.toThrow("scopes changed");
    },
  );
  it("YouTube requires an unambiguous verified channel before owner selection", async () => {
    const s = await fixture("youtube");
    const fetcher = vi.fn(async (raw: string | URL | Request) =>
      String(raw).includes("/token")
        ? Response.json({
            access_token: "synthetic-secret",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/youtube.upload",
          })
        : Response.json({
            items: [
              { id: "UCone", snippet: { title: "One" } },
              { id: "UCtwo", snippet: { title: "Two" } },
            ],
          }),
    );
    const oauth = new SocialOAuth(s.social, { youtube: s.config }, fetcher);
    const state = new URL((await oauth.begin(owner, s.account.id)).url).searchParams.get("state")!;
    await expect(
      oauth.callback("youtube", new URLSearchParams({ state, code: "code" })),
    ).rejects.toThrow("exactly one");
    expect(await oauth.status(owner, s.account.id)).toMatchObject({
      status: "failed",
      candidates: [],
    });
    expect(s.tokens.size).toBe(0);
    expect(JSON.stringify(await oauth.status(owner, s.account.id))).not.toContain(
      "synthetic-secret",
    );
  });
  it.each(["x", "instagram", "facebook", "linkedin", "youtube"] as const)(
    "%s akışında doğrulanan hesap seçilir; token yalnız host kasasına gider",
    async (platform) => {
      const s = await fixture(platform);
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const path = new URL(String(raw)).pathname;
        if (path.endsWith("token") || path.endsWith("accessToken"))
          return Response.json({
            access_token: "synthetic-secret",
            expires_in: 7200,
            scope:
              platform === "x"
                ? "tweet.read tweet.write users.read"
                : platform === "youtube"
                  ? "https://www.googleapis.com/auth/youtube.readonly"
                  : undefined,
            permissions: platform === "instagram" ? ["instagram_business_basic"] : undefined,
          });
        if (path === "/2/users/me")
          return Response.json({ data: { id: "123", username: "verified" } });
        if (path.endsWith("/permissions"))
          return Response.json({
            data: [{ permission: "pages_read_engagement", status: "granted" }],
          });
        if (path.endsWith("/accounts"))
          return Response.json({
            data: [
              {
                id: "page123",
                name: "Verified page",
                access_token: "synthetic-page-secret",
                tasks: ["CREATE_CONTENT"],
              },
            ],
          });
        if (path.endsWith("/userinfo"))
          return Response.json({ sub: "member123", name: "Verified member" });
        if (path.endsWith("/channels"))
          return Response.json({
            items: [{ id: "UCverified", snippet: { title: "Verified channel" } }],
          });
        return Response.json({
          user_id: "ig123",
          username: "verified",
          account_type: "BUSINESS",
        });
      }) as unknown as typeof fetch;
      const oauth = new SocialOAuth(s.social, { [platform]: s.config }, fetcher);
      const start = await oauth.begin(owner, s.account.id);
      const state = new URL(start.url).searchParams.get("state")!;
      if (platform === "youtube") {
        expect(new URL(start.url).hostname).toBe("accounts.google.com");
        expect(new URL(start.url).searchParams.get("access_type")).toBe("offline");
      }
      if (platform === "x")
        expect(new URL(start.url).searchParams.get("code_challenge_method")).toBe("S256");
      await oauth.callback(platform, new URLSearchParams({ state, code: "synthetic-code" }));
      const status = await oauth.status(owner, s.account.id);
      expect(status.status).toBe("selection");
      expect(JSON.stringify(status)).not.toContain("synthetic-secret");
      expect(JSON.stringify(status)).not.toContain("page-secret");
      const connected = await oauth.select(owner, s.account.id, status.candidates[0].id);
      expect(connected.platformId).toBeTruthy();
      expect(s.tokens.get(connected.id)?.accessToken).toContain("synthetic-");
      expect(JSON.stringify(connected)).not.toContain("secret");
      if (platform === "linkedin") expect(connected.scopes).toEqual([]); // Requested scopes were not granted evidence.
      if (platform === "youtube") {
        expect(connected.platformId).toBe("UCverified");
        expect(connected.scopes).toEqual(["https://www.googleapis.com/auth/youtube.readonly"]);
        expect(connected.scopes).not.toContain("https://www.googleapis.com/auth/youtube.upload");
      }
      await expect(
        oauth.callback(platform, new URLSearchParams({ state, code: "replay" })),
      ).rejects.toThrow("invalid");
    },
  );
  it("süresi dolan state, sahte state ve farklı platform callback'i ağ isteği yapamaz", async () => {
    const s = await fixture();
    const fetcher = vi.fn();
    let now = Date.now();
    const oauth = new SocialOAuth(s.social, { x: s.config }, fetcher, () => now);
    const start = await oauth.begin(owner, s.account.id);
    const state = new URL(start.url).searchParams.get("state")!;
    await expect(
      oauth.callback("instagram", new URLSearchParams({ state, code: "code" })),
    ).rejects.toThrow("invalid");
    now += 11 * 60000;
    await expect(oauth.callback("x", new URLSearchParams({ state, code: "code" }))).rejects.toThrow(
      "expired",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("callback yapılandırmasında dış HTTP ve credential içeren URL kabul edilmez", () => {
    expect(() =>
      socialOAuthConfigs({
        BYCODA_SOCIAL_X_CLIENT_ID: "id",
        BYCODA_SOCIAL_X_REDIRECT_URI: "http://outside.test/social/oauth/x/callback",
      }),
    ).toThrow("callback");
    expect(() =>
      socialOAuthConfigs({
        BYCODA_SOCIAL_X_CLIENT_ID: "id",
        BYCODA_SOCIAL_X_REDIRECT_URI: "https://user:secret@host.test/social/oauth/x/callback",
      }),
    ).toThrow("callback");
  });
});
