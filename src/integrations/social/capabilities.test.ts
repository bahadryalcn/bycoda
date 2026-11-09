import { describe, expect, it } from "vitest";
import {
  SOCIAL_API_ACCOUNT_TYPES,
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialPlatform,
} from "../../features/social/model/social";
import { accountCapabilities, platformRequirements, X_BROWSER_SCOPES } from "./capabilities";
import { browserOperations } from "./browserCapabilities";
import { CAPABILITY_OPERATIONS, NOT_YET_OPERATIONS } from "./capabilities/shared";

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount => ({
  id: "a",
  platform: "x",
  platformId: "42",
  name: "Fixture",
  accountType: "member",
  connection: "browser",
  scopes: [],
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
  ...overrides,
});
const apiAccount = (platform: SocialPlatform, overrides: Partial<SocialAccount> = {}) =>
  account({
    platform,
    platformId: "verified",
    accountType: SOCIAL_API_ACCOUNT_TYPES[platform][0] as SocialAccount["accountType"],
    connection: "token",
    scopes: [],
    ...overrides,
  });
const browserTypeOf = (platform: SocialPlatform): SocialAccount["accountType"] =>
  (platform === "snapchat" ? "public_profile" : "member") as SocialAccount["accountType"];
const browserAccount = (platform: SocialPlatform, overrides: Partial<SocialAccount> = {}) =>
  account({ platform, accountType: browserTypeOf(platform), ...overrides });
const row = (caps: ReturnType<typeof accountCapabilities>, operation: string) =>
  caps.find((item) => item.operation === operation)!;

/** Scope names that exist only in API products. A browser account must never show them. */
const API_SCOPE_NAMES =
  /dm\.read|dm\.write|tweet\.read|tweet\.write|users\.read|media\.write|pages_|instagram_business_|w_member_social|r_member_social|w_organization_social|r_organization_social|channel\.publish|bot\.send|bot\.poll|video\.publish|snapchat-profile-api|OAuth|X API/;

it("exposes Telegram channel publish/media without bot inbox, DM or polling permissions", () => {
  const telegram: SocialAccount = {
    id: "channel",
    platform: "telegram",
    platformId: "-1001234567890",
    telegramBotId: "123",
    accountType: "channel",
    connection: "token",
    name: "Bycoda",
    scopes: ["channel.publish"],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
  };
  const caps = accountCapabilities(telegram);
  expect(caps.find((item) => item.operation === "publish")?.status).toBe("available");
  expect(caps.find((item) => item.operation === "media")?.status).toBe("available");
  for (const operation of ["inbox.read", "message.reply", "message.start", "comments.read", "poll"])
    expect(caps.find((item) => item.operation === operation)?.status).toBe("unsupported");
  const pending = accountCapabilities({ ...telegram, scopes: [] });
  expect(pending.find((item) => item.operation === "publish")?.status).toBe("pending");
  expect(platformRequirements("telegram", "bot").publish.unsupported).toBe(true);
  expect(platformRequirements("telegram", "bot")["inbox.read"].scopes).toEqual(["bot.poll"]);
  expect(platformRequirements("telegram", "bot")["message.reply"].scopes).toEqual(["bot.send"]);
});

describe("X browser connection", () => {
  it("describes publish in browser terms, without OAuth or X API wording", () => {
    const publish = row(accountCapabilities(account({ platform: "x", scopes: [] })), "publish");
    expect(publish.status).toBe("available");
    expect(publish.reasonCode).toBe("browser.ready");
    expect(publish.reason).not.toMatch(API_SCOPE_NAMES);
    expect(publish.reason).toContain("X web session");
  });

  it("keeps message.reply available for an older account stored before DM pseudo-scopes", () => {
    const legacy = account({
      platform: "x",
      scopes: ["tweet.write", "tweet.read", "users.read", "media.write"],
    });
    const caps = accountCapabilities(legacy);
    expect(row(caps, "message.reply").status).toBe("available");
    expect(row(caps, "inbox.read").status).toBe("available");
    expect(row(caps, "poll").status).toBe("available");
    expect(caps.some((item) => item.status === "pending")).toBe(false);
    for (const item of caps) expect(item.reason).not.toMatch(/dm\.read|dm\.write/);
  });

  it("does not depend on the stored scope list at all", () => {
    const withScopes = accountCapabilities(account({ platform: "x", scopes: X_BROWSER_SCOPES }));
    const withoutScopes = accountCapabilities(account({ platform: "x", scopes: [] }));
    expect(withScopes.map((item) => item.status)).toEqual(withoutScopes.map((item) => item.status));
  });

  it("asks for a browser sign-in with a browser reason code when the session is not approved", () => {
    const pending = row(
      accountCapabilities(account({ platform: "x", accessApproved: false })),
      "publish",
    );
    expect(pending.status).toBe("pending");
    expect(pending.reasonCode).toBe("browser.reconnect");
    expect(pending.reason).not.toMatch(API_SCOPE_NAMES);
  });

  it("states that Encrypted Chat is unavailable on X", () => {
    const caps = accountCapabilities(account({ platform: "x" }));
    expect(row(caps, "inbox.read").reason).toContain("Encrypted Chat");
    expect(row(caps, "message.reply").reason).toContain("Encrypted Chat");
  });
});

describe("X API connection", () => {
  it("keeps the OAuth scope requirement and its API reason code", () => {
    const publish = row(accountCapabilities(apiAccount("x")), "publish");
    expect(publish.status).toBe("pending");
    expect(publish.reasonCode).toBe("x.publish.api_required");
    expect(publish.reason).toContain("OAuth");
  });
});

describe("browser accounts across platforms", () => {
  const browserPlatforms = SOCIAL_PLATFORMS.filter((platform) => platform !== "reddit");

  it("never name API scopes or OAuth in any browser reason", () => {
    for (const platform of browserPlatforms) {
      for (const item of accountCapabilities(browserAccount(platform, { scopes: [] }))) {
        expect(item.reason, `${platform}.${item.operation}`).not.toMatch(API_SCOPE_NAMES);
      }
    }
  });

  it("mentions Encrypted Chat only for X", () => {
    for (const platform of browserPlatforms) {
      const reasons = accountCapabilities(browserAccount(platform)).map((item) => item.reason);
      const mentions = reasons.some((reason) => reason.includes("Encrypted Chat"));
      expect(mentions, platform).toBe(platform === "x");
    }
  });

  it("returns no stored scope names on any browser row", () => {
    for (const platform of browserPlatforms) {
      const caps = accountCapabilities(browserAccount(platform, { scopes: [] }));
      for (const item of caps) expect(item.scopes, `${platform}.${item.operation}`).toEqual([]);
    }
  });
});

describe("capability table shape", () => {
  it("returns every operation with a reason code for every platform and connection", () => {
    for (const platform of SOCIAL_PLATFORMS) {
      for (const caps of [
        accountCapabilities(apiAccount(platform)),
        accountCapabilities(browserAccount(platform)),
      ]) {
        expect(caps.map((item) => item.operation).sort()).toEqual(
          [...CAPABILITY_OPERATIONS].sort(),
        );
        for (const item of caps) expect(item.reasonCode.length, platform).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the Reddit browser connection unsupported while its API rows follow the Reddit table", () => {
    for (const item of accountCapabilities(browserAccount("reddit")))
      expect(item.status, item.operation).toBe("unsupported");
    const api = accountCapabilities(apiAccount("reddit"));
    expect(row(api, "analytics")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
    expect(row(api, "delete").reasonCode).toBe("reddit.delete.api_required");
  });

  it("marks the new operations unsupported with unsupported.not_yet unless the API or a browser recipe opens them", () => {
    for (const platform of SOCIAL_PLATFORMS) {
      // API opens (per platform table; each platform test confirms it):
      // YouTube: analytics, audience.collect, profile.read (youtube-capabilities.test.ts).
      // Telegram bot: delete, audience.collect (capabilities/telegram.test.ts).
      // Meta: Facebook delete, analytics, audience.collect; Instagram analytics, audience.collect.
      // TikTok: analytics only (capabilities/tiktok.test.ts). X: delete, analytics, audience.collect, profile.read.
      // Reddit: delete, audience.collect, profile.read (capabilities/reddit.ts).
      const openedByApi =
        platform === "youtube"
          ? ["analytics", "audience.collect", "profile.read"]
          : platform === "tiktok"
            ? ["analytics"]
            : platform === "telegram"
              ? ["delete", "audience.collect"]
              : platform === "facebook"
                ? ["delete", "analytics", "audience.collect"]
                : platform === "instagram"
                  ? ["analytics", "audience.collect"]
                  : platform === "x"
                    ? ["delete", "analytics", "audience.collect", "profile.read"]
                    : platform === "reddit"
                      ? ["delete", "audience.collect", "profile.read"]
                      : [];
      // Browser recipes that open a not-yet operation (browserCapabilities.ts). The row is then "available".
      const openedByBrowser = browserOperations(browserAccount(platform)) as readonly string[];
      for (const operation of NOT_YET_OPERATIONS) {
        const api = row(accountCapabilities(apiAccount(platform)), operation);
        if (openedByApi.includes(operation))
          expect(api.reasonCode, `${platform}.${operation} api`).not.toBe("unsupported.not_yet");
        else {
          expect(api.status, `${platform}.${operation} api`).toBe("unsupported");
          expect(api.reasonCode, `${platform}.${operation} api`).toBe("unsupported.not_yet");
        }
        const browser = row(accountCapabilities(browserAccount(platform)), operation);
        if (openedByBrowser.includes(operation))
          expect(browser.status, `${platform}.${operation} browser`).toBe("available");
        else {
          expect(browser.status, `${platform}.${operation} browser`).toBe("unsupported");
          expect(browser.reasonCode, `${platform}.${operation} browser`).toBe(
            "unsupported.not_yet",
          );
        }
      }
    }
  });

  it("opens LinkedIn audience collection only for an organization on the API", () => {
    const member = row(accountCapabilities(apiAccount("linkedin")), "audience.collect");
    expect(member.reasonCode).toBe("unsupported.not_yet");
    const organization = row(
      accountCapabilities(apiAccount("linkedin", { accountType: "organization" })),
      "audience.collect",
    );
    expect(organization.reasonCode).not.toBe("unsupported.not_yet");
  });

  it("passes the requirement's reasonCode through for an unsupported API row", () => {
    expect(row(accountCapabilities(apiAccount("tiktok")), "search")).toMatchObject({
      status: "unsupported",
      reasonCode: "tiktok.search_requires_research_api",
    });
  });
});

describe("Snapchat copy", () => {
  it("describes Spotlight publishing as available and does not say publishing is missing", () => {
    const caps = accountCapabilities(apiAccount("snapchat", { scopes: ["snapchat-profile-api"] }));
    expect(row(caps, "publish").status).toBe("available");
    expect(row(caps, "publish").reason).not.toMatch(/Publishing.*not implemented/);
    expect(row(caps, "reply").reason).toContain("Spotlight publishing");
  });
});
