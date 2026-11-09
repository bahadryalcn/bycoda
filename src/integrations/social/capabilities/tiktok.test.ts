import { describe, expect, it } from "vitest";
import type { SocialAccount } from "../../../features/social/model/social";
import { accountCapabilities } from "../capabilities";
import { TIKTOK_SEARCH_REQUIREMENT, tiktokCapabilities } from "./tiktok";
import type { SocialCapability } from "./shared";

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "a",
    platform: "tiktok",
    platformId: "creator",
    name: "Owner",
    accountType: "member",
    connection: "token",
    scopes: ["user.info.basic", "video.publish", "video.list"],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
    ...overrides,
  }) as SocialAccount;
const browser = (overrides: Partial<SocialAccount> = {}) =>
  account({ connection: "browser", scopes: [], platformId: "web:tiktok:bycoda", ...overrides });
const row = (caps: SocialCapability[], operation: string) =>
  caps.find((item) => item.operation === operation)!;

describe("TikTok API capability map", () => {
  it("opens the Display API analytics row and keeps the rest of the platform as stated", () => {
    const caps = accountCapabilities(account());
    expect(row(caps, "publish")).toMatchObject({ status: "available", reasonCode: "api.ready" });
    expect(row(caps, "analytics")).toMatchObject({ status: "available", reasonCode: "api.ready" });
    expect(tiktokCapabilities().api.analytics.scopes).toEqual(["user.info.basic", "video.list"]);
    for (const operation of [
      "comments.read",
      "reply",
      "comment",
      "inbox.read",
      "message.start",
      "webhook",
      "poll",
    ])
      expect(row(caps, operation).status, operation).toBe("unsupported");
  });

  it("asks for video.list before analytics is available", () => {
    const caps = accountCapabilities(account({ scopes: ["user.info.basic", "video.publish"] }));
    expect(row(caps, "analytics")).toMatchObject({
      status: "pending",
      reasonCode: "tiktok.analytics.api_required",
    });
  });

  it("keeps hashtag and keyword search NOT_SUPPORTED with its own reason code", () => {
    expect(TIKTOK_SEARCH_REQUIREMENT.reasonCode).toBe("tiktok.search_requires_research_api");
    const caps = accountCapabilities(account());
    expect(row(caps, "search")).toMatchObject({ status: "unsupported" });
    // The requirement carries reasonCode; capabilities.ts passes it through for unsupported rows.
    expect(row(caps, "search").reasonCode).toBe("tiktok.search_requires_research_api");
  });

  it("leaves commenter collection, deletion and profile reads NOT_SUPPORTED on the API", () => {
    const caps = accountCapabilities(account());
    expect(row(caps, "audience.collect")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
    expect(row(caps, "delete")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
    expect(row(caps, "profile.read")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
  });
});

describe("TikTok browser capability map", () => {
  it("offers publishing and comment actions only with a verified browser session", () => {
    expect(
      row(accountCapabilities(browser({ connected: false, accessApproved: false })), "publish"),
    ).toMatchObject({ status: "pending", reasonCode: "browser.reconnect" });
    const ready = accountCapabilities(browser({ connected: true, accessApproved: true }));
    expect(row(ready, "publish")).toMatchObject({
      status: "available",
      reasonCode: "browser.ready",
    });
    expect(row(ready, "publish").reason).toContain("TikTok Studio");
    expect(row(ready, "comment").status).toBe("available");
  });

  it("does not show API scope names or analytics/search on the browser connection", () => {
    const caps = accountCapabilities(browser({ connected: true, accessApproved: true }));
    for (const item of caps)
      expect(item.reason, item.operation).not.toMatch(/video\.list|video\.publish|OAuth/);
    expect(row(caps, "analytics")).toMatchObject({ status: "unsupported" });
    expect(row(caps, "search")).toMatchObject({
      status: "unsupported",
      reasonCode: "browser.no_recipe",
    });
    expect(row(caps, "inbox.read")).toMatchObject({ status: "unsupported" });
  });
});
