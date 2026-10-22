import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "./adapter";
import { createSocialAdapters } from "./platformAdapters";
import { accountCapabilities } from "./capabilities";
import type { SocialAccount, SocialJob } from "../../features/social/model/social";

const account = (platform: SocialAccount["platform"]): SocialAccount => ({
  id: "account",
  platform,
  platformId: "123456",
  name: "Account",
  accountType: platform === "telegram" ? "bot" : "business",
  scopes: ["bot.send", "bot.poll", "whatsapp_business_messaging", "bycoda.webhook"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const job = (): SocialJob => ({
  id: "job",
  operationId: "op",
  dedupeKey: "key",
  accountId: "account",
  projectIds: ["project"],
  provider: "owner",
  actorId: "owner",
  kind: "reply",
  payload: { text: "Reply", media: [], recipientId: "1234567890", threadId: "-123456" },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});

describe("Messaging adapters", () => {
  it("Telegram persists the high-water offset, ignores non-message updates and separates identical message IDs in different chats", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({
        ok: true,
        result: [
          {
            update_id: 10,
            message: {
              message_id: 2,
              date: 100,
              text: "One",
              chat: { id: 123, first_name: "One" },
            },
          },
          {
            update_id: 11,
            message: { message_id: 2, date: 100, text: "Two", chat: { id: -456, title: "Group" } },
          },
          { update_id: 12, edited_message: {} },
        ],
      }),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).telegram;
    const result = await adapter.poll(account("telegram"), "123:test_token", [], "10");
    expect(result.cursor).toBe("13");
    expect(result.events.map((event) => [event.eventId, event.threadId])).toEqual([
      ["123:2", "123"],
      ["-456:2", "-456"],
    ]);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
      offset: 10,
      allowed_updates: ["message"],
    });
  });
  it("Telegram replies to the original group chat without parse-mode injection", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({ ok: true, result: { message_id: 3, chat: { id: -123456 } } }),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).telegram;
    expect(
      await adapter.send(
        account("telegram"),
        job(),
        "123:test_token",
        async () => new Uint8Array(),
      ),
    ).toEqual({ platformId: "-123456:3" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      chat_id: "-123456",
      text: "Reply",
    });
    const unsupported = job();
    unsupported.kind = "publish";
    await expect(
      adapter.send(
        account("telegram"),
        unsupported,
        "123:test_token",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("Telegram sanitizes token-bearing fetch errors and honors JSON retry_after", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("https://api.telegram.org/bot123:secret/getMe");
    });
    await expect(new SocialHttp(fetcher).telegram("getMe", "123:secret")).rejects.toMatchObject({
      code: "unknown",
      message: "Platform outcome is uncertain. Review before another send.",
    });
    const limited = new SocialHttp(
      async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 90 } }),
      () => 1000,
    );
    await expect(limited.telegram("sendMessage", "123:secret")).rejects.toMatchObject({
      code: "rate_limit",
      retryAt: 91000,
    });
  });
  it("WhatsApp sends text replies and rejects initiation before network I/O", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({ messages: [{ id: "wamid.example" }] }),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).whatsapp;
    expect(
      await adapter.send(account("whatsapp"), job(), "secret", async () => new Uint8Array()),
    ).toEqual({ platformId: "wamid.example" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
      messaging_product: "whatsapp",
      to: "1234567890",
      text: { body: "Reply" },
    });
    const outreach = job();
    outreach.kind = "message";
    await expect(
      adapter.send(account("whatsapp"), outreach, "secret", async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["snapchat"] as const)(
    "%s never advertises unimplemented sends as available",
    (platform) => {
      expect(
        accountCapabilities(account(platform)).every(
          (capability) => capability.status === "unsupported",
        ),
      ).toBe(true);
    },
  );
  it("WhatsApp messaging stays pending until the signed receiver is configured", () => {
    const a = account("whatsapp");
    a.scopes = ["whatsapp_business_messaging"];
    expect(
      accountCapabilities(a).find((capability) => capability.operation === "message.reply")?.status,
    ).toBe("pending");
  });
});
