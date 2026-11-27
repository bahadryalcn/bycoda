import { describe, expect, it } from "vitest";
import type { SocialAccount } from "../../features/social/model/social";
import { accountCapabilities } from "./capabilities";

const base: SocialAccount = {
  id: "account",
  platform: "youtube",
  platformId: "UCowner",
  name: "Channel",
  accountType: "channel",
  scopes: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ],
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
};
const apiAccount: SocialAccount = { ...base, connection: "oauth" };
const browserAccount: SocialAccount = { ...base, connection: "browser", scopes: [] };
const row = (account: SocialAccount, operation: string) => {
  const found = accountCapabilities(account).find((item) => item.operation === operation);
  if (!found) throw new Error(`missing ${operation}`);
  return found;
};

describe("YouTube capability map", () => {
  it("opens the API operations implemented by the adapter", () => {
    for (const operation of ["publish", "comments.read", "reply", "comment", "poll"])
      expect(row(apiAccount, operation).status, operation).toBe("available");
    for (const operation of ["analytics", "audience.collect", "profile.read"]) {
      expect(row(apiAccount, operation).status, operation).toBe("available");
      expect(row(apiAccount, operation).reasonCode, operation).toBe("api.ready");
    }
  });

  it("keeps operations without an implementation unsupported with a stable reason", () => {
    expect(row(apiAccount, "message.reply")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
    expect(row(apiAccount, "search").status).toBe("unsupported");
    expect(row(apiAccount, "webhook").status).toBe("unsupported");
  });

  it("declares scoped YouTube management and Studio operations", () => {
    for (const operation of [
      "delete",
      "video.update",
      "thumbnail.set",
      "playlists.manage",
      "comment.moderate",
      "subscribe",
      "channel.profile.update",
      "live.manage",
      "live.chat",
    ])
      expect(row(apiAccount, operation)).toMatchObject({
        status: "available",
        reasonCode: "api.ready",
      });
    expect(row(apiAccount, "analytics.report")).toMatchObject({
      status: "pending",
      scopes: expect.arrayContaining(["https://www.googleapis.com/auth/yt-analytics.readonly"]),
    });
    expect(row(apiAccount, "monetization.read")).toMatchObject({
      status: "pending",
      scopes: expect.arrayContaining([
        "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
      ]),
    });
    for (const operation of [
      "channel.profile.update",
      "community.publish",
      "comment.react",
      "monetization.status",
    ])
      expect(row(browserAccount, operation)).toMatchObject({
        status: "available",
        reasonCode: "browser.ready",
      });
    expect(row(apiAccount, "community.publish")).toMatchObject({
      status: "unsupported",
      reasonCode: "youtube.browser_required",
    });
  });

  it("offers browser publishing, replies and polling only from the Studio recipe", () => {
    for (const operation of ["publish", "comments.read", "reply", "comment", "poll"])
      expect(row(browserAccount, operation).status, operation).toBe("available");
    for (const operation of ["analytics", "audience.collect", "profile.read", "message.start"])
      expect(row(browserAccount, operation).status, operation).toBe("unsupported");
  });
});
