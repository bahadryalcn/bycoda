import { describe, expect, it } from "vitest";
import type { SocialAccount } from "../../../features/social/model/social";
import { accountCapabilities } from "../capabilities";
import { CAPABILITY_OPERATIONS } from "./shared";

const now = Date.parse("2026-11-07T10:00:00Z");
const base = (overrides: Partial<SocialAccount>): SocialAccount => ({
  id: "synthetic",
  platform: "snapchat",
  platformId: "11111111-1111-1111-1111-111111111111",
  name: "Bycoda",
  accountType: "public_profile",
  scopes: ["snapchat-profile-api"],
  connected: true,
  accessApproved: true,
  paused: false,
  connection: "oauth",
  executorId: "synthetic-host",
  grants: {},
  createdAt: 1,
  ...overrides,
});
const apiProfile = () => base({});
const browserProfile = (connected = true) =>
  base({
    platformId: "web:snapchat:public_profile:11111111-1111-1111-1111-111111111111",
    scopes: [],
    connection: "browser",
    connected,
    accessApproved: connected,
  });
const browserMember = (connected = true) =>
  base({
    platformId: "web:snapchat:bycoda",
    accountType: "member",
    scopes: [],
    connection: "browser",
    connected,
    accessApproved: connected,
  });
const row = (caps: ReturnType<typeof accountCapabilities>, operation: string) =>
  caps.find((item) => item.operation === operation)!;

describe("Snapchat capability map", () => {
  it("lists every operation with a reason code in every connection mode", () => {
    for (const account of [apiProfile(), browserProfile(), browserMember()]) {
      const caps = accountCapabilities(account, now);
      expect(caps.map((item) => item.operation).sort()).toEqual([...CAPABILITY_OPERATIONS].sort());
      for (const item of caps) expect(item.reasonCode, item.operation).toBeTruthy();
    }
  });
  it("opens Spotlight publishing and media through the API with a verified profile", () => {
    const caps = accountCapabilities(apiProfile(), now);
    expect(row(caps, "publish")).toMatchObject({ status: "available", reasonCode: "api.ready" });
    expect(row(caps, "media").status).toBe("available");
  });
  it("marks API operations without a Snapchat API as unsupported with a platform reason", () => {
    const caps = accountCapabilities(apiProfile(), now);
    for (const operation of [
      "comments.read",
      "reply",
      "comment",
      "inbox.read",
      "message.reply",
      "message.start",
      "search",
      "webhook",
      "poll",
    ]) {
      expect(row(caps, operation), operation).toMatchObject({
        status: "unsupported",
        reasonCode: "unsupported.platform",
      });
    }
    expect(row(caps, "audience.collect")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
  });
  it("keeps the Public Profile browser route to publish and media only", () => {
    const caps = accountCapabilities(browserProfile(false), now);
    expect(row(caps, "publish")).toMatchObject({
      status: "pending",
      reasonCode: "browser.reconnect",
    });
    expect(row(caps, "reply")).toMatchObject({
      status: "unsupported",
      reasonCode: "browser.no_recipe",
    });
    expect(row(caps, "inbox.read").status).toBe("unsupported");
  });
  it("opens existing member chats in the browser and nothing else for a member", () => {
    const connected = accountCapabilities(browserMember(), now);
    for (const operation of ["inbox.read", "message.reply", "poll"]) {
      expect(row(connected, operation), operation).toMatchObject({
        status: "available",
        reasonCode: "browser.ready",
      });
    }
    expect(row(connected, "publish").status).toBe("unsupported");
    expect(row(connected, "message.start").status).toBe("unsupported");
    const disconnected = accountCapabilities(browserMember(false), now);
    expect(row(disconnected, "poll")).toMatchObject({
      status: "pending",
      reasonCode: "browser.reconnect",
    });
  });
  it("describes browser rows without API scope names or OAuth wording", () => {
    for (const item of accountCapabilities(browserProfile(), now)) {
      expect(item.reason, item.operation).not.toMatch(/snapchat-profile-api|Marketing API|OAuth/);
    }
  });
  it("says a browser Spotlight is confirmed only by read-back from the profile", () => {
    const caps = accountCapabilities(browserProfile(), now);
    expect(row(caps, "publish").status).toBe("available");
    expect(row(caps, "publish").reason).toMatch(/read back/);
  });
});
