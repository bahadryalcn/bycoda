import { describe, expect, it } from "vitest";
import type { SocialAccount } from "../../../features/social/model/social";
import { accountCapabilities } from "../capabilities";

const base = (overrides: Partial<SocialAccount>): SocialAccount => ({
  id: "telegram",
  platform: "telegram",
  platformId: "123",
  name: "Telegram",
  accountType: "bot",
  connection: "token",
  scopes: ["bot.send", "bot.poll"],
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
  ...overrides,
});
const bot = (overrides: Partial<SocialAccount> = {}) => base(overrides);
const channel = (overrides: Partial<SocialAccount> = {}) =>
  base({
    accountType: "channel",
    platformId: "-1001234567890",
    telegramBotId: "123",
    scopes: ["channel.publish"],
    ...overrides,
  });
const personal = (overrides: Partial<SocialAccount> = {}) =>
  base({ accountType: "member", connection: "browser", scopes: [], ...overrides });
const row = (caps: ReturnType<typeof accountCapabilities>, operation: string) =>
  caps.find((item) => item.operation === operation)!;

describe("Telegram capability map", () => {
  it("opens delete and audience collection for the bot token connection when its scopes are present", () => {
    const caps = accountCapabilities(bot());
    expect(row(caps, "delete")).toMatchObject({ status: "available", scopes: ["bot.send"] });
    expect(row(caps, "audience.collect")).toMatchObject({
      status: "available",
      scopes: ["bot.poll"],
      reasonCode: "api.ready",
    });
  });

  it("marks bot audience collection pending while polling is unavailable", () => {
    const caps = accountCapabilities(bot({ scopes: ["bot.send"] }));
    expect(row(caps, "audience.collect").status).toBe("pending");
  });

  it("states that bots cannot start a conversation and keeps webhook ingest off", () => {
    const caps = accountCapabilities(bot());
    expect(row(caps, "message.start")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
    expect(row(caps, "webhook")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
  });

  it("publishes to a channel with delete, and keeps channel audience collection unsupported", () => {
    const caps = accountCapabilities(channel());
    expect(row(caps, "publish")).toMatchObject({ status: "available", reasonCode: "api.ready" });
    expect(row(caps, "delete")).toMatchObject({ status: "available", scopes: ["channel.publish"] });
    expect(row(caps, "media").reason).toContain("10 MiB");
    expect(row(caps, "audience.collect")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
    expect(row(caps, "message.start").status).toBe("unsupported");
  });

  it("keeps analytics and profile reading unsupported for the Bot API", () => {
    for (const caps of [accountCapabilities(bot()), accountCapabilities(channel())]) {
      expect(row(caps, "analytics")).toMatchObject({
        status: "unsupported",
        reasonCode: "unsupported.not_yet",
      });
      expect(row(caps, "profile.read")).toMatchObject({
        status: "unsupported",
        reasonCode: "unsupported.not_yet",
      });
    }
  });

  it("keeps the personal browser session free of Bot API operations", () => {
    const caps = accountCapabilities(personal());
    for (const operation of ["publish", "delete", "audience.collect", "webhook", "analytics"]) {
      expect(row(caps, operation).status, operation).toBe("unsupported");
    }
    expect(row(caps, "poll").status).toBe("available");
    expect(row(caps, "delete").reasonCode).toBe("unsupported.not_yet");
  });
});
