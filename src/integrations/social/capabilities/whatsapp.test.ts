import { describe, expect, it } from "vitest";
import type { SocialAccount, SocialOperation } from "../../../features/social/model/social";
import { accountCapabilities } from "../capabilities";

const apiAccount = (scopes: string[], connected = true): SocialAccount =>
  ({
    id: "api",
    platform: "whatsapp",
    platformId: "123456789012",
    name: "Synthetic Business",
    accountType: "business",
    connection: "token",
    scopes,
    accessApproved: true,
    connected,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
  }) as SocialAccount;

const browserAccount = (): SocialAccount =>
  ({
    id: "browser",
    platform: "whatsapp",
    platformId: "web:whatsapp:+905551234567",
    name: "Synthetic Personal",
    accountType: "member",
    connection: "browser",
    scopes: [],
    accessApproved: true,
    connected: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
  }) as SocialAccount;

const row = (caps: ReturnType<typeof accountCapabilities>, operation: SocialOperation) => {
  const found = caps.find((item) => item.operation === operation);
  if (!found) throw new Error(`missing ${operation}`);
  return found;
};

describe("WhatsApp capability map", () => {
  const full = ["whatsapp_business_messaging", "bycoda.webhook"];

  it("opens template-only business messages and keeps the 24-hour reply window", () => {
    const caps = accountCapabilities(apiAccount(full));
    expect(row(caps, "message.start")).toMatchObject({
      status: "available",
      reasonCode: "api.ready",
      scopes: ["whatsapp_business_messaging"],
    });
    expect(row(caps, "message.start").reason).toContain("approved template");
    expect(row(caps, "message.reply")).toMatchObject({
      status: "available",
      reasonCode: "api.ready",
    });
    expect(row(caps, "media").status).toBe("available");
  });

  it("marks message.start pending until the messaging scope is granted", () => {
    const caps = accountCapabilities(apiAccount([]));
    expect(row(caps, "message.start")).toMatchObject({
      status: "pending",
      reasonCode: "whatsapp.message.start.api_required",
    });
  });

  it("keeps unimplemented API operations unsupported with stable reason codes", () => {
    const caps = accountCapabilities(apiAccount(full));
    for (const operation of [
      "publish",
      "comments.read",
      "poll",
      "search",
      "delete",
      "analytics",
      "profile.read",
    ] as const) {
      expect(row(caps, operation).status, operation).toBe("unsupported");
    }
    expect(row(caps, "audience.collect")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
  });

  it("personal browser rows expose only the WhatsApp Web operations with bulk limits in the reason", () => {
    const caps = accountCapabilities(browserAccount());
    expect(row(caps, "message.start")).toMatchObject({
      status: "available",
      reasonCode: "browser.ready",
    });
    expect(row(caps, "message.start").reason).toContain("Bulk");
    expect(row(caps, "inbox.read").reason).toContain("groups are skipped");
    expect(row(caps, "publish").status).toBe("unsupported");
    // No WhatsApp chat-sender reader is wired (dm_senders), so the browser row stays not-yet like the API row.
    expect(row(caps, "audience.collect")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
  });

  it("reports an expired browser session instead of a ready row", () => {
    const expired = { ...browserAccount(), expiresAt: 1 };
    expect(row(accountCapabilities(expired, 2), "message.start")).toMatchObject({
      status: "expired",
      reasonCode: "browser.session_expired",
    });
  });
});
