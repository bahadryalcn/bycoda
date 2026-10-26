import { expect, it } from "vitest";
import type { SocialAccount } from "../../features/social/model/social";
import { accountCapabilities, platformRequirements } from "./capabilities";

it("exposes Telegram channel publish/media without bot inbox, DM or polling permissions", () => {
  const account: SocialAccount = {
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
  const caps = accountCapabilities(account);
  expect(caps.find((item) => item.operation === "publish")?.status).toBe("available");
  expect(caps.find((item) => item.operation === "media")?.status).toBe("available");
  for (const operation of ["inbox.read", "message.reply", "message.start", "comments.read", "poll"])
    expect(caps.find((item) => item.operation === operation)?.status).toBe("unsupported");
  const pending = accountCapabilities({ ...account, scopes: [] });
  expect(pending.find((item) => item.operation === "publish")?.status).toBe("pending");
  expect(platformRequirements("telegram", "bot").publish.unsupported).toBe(true);
  expect(platformRequirements("telegram", "bot")["inbox.read"].scopes).toEqual(["bot.poll"]);
  expect(platformRequirements("telegram", "bot")["message.reply"].scopes).toEqual(["bot.send"]);
});
