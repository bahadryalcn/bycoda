import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { receiveTelegramWebhook } from "./social-webhooks";
import { telegramWebhookSecret } from "../token-connections/telegram";
import type { SocialService } from "../social";

const ACCOUNT_ID = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "123456:fixture-bot-token-for-tests-only";
const SECRET = telegramWebhookSecret(TOKEN, ACCOUNT_ID);

const bot: SocialAccount = {
  id: ACCOUNT_ID,
  platform: "telegram",
  platformId: "123456",
  name: "Fixture bot",
  accountType: "bot",
  connection: "api",
  scopes: [],
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
} as unknown as SocialAccount;

function service(accounts: SocialAccount[] = [bot]) {
  const ingest = vi.fn(async (_accountId: string, events: unknown[]) => events.length);
  const s = {
    store: { environmentId: "host" },
    list: vi.fn(async () => accounts),
    credentialFor: vi.fn(async () => ({ accessToken: TOKEN })),
    ingest,
  };
  return {
    s: s as unknown as Pick<SocialService, "credentialFor" | "ingest" | "list" | "store">,
    ingest,
  };
}

const update = (overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      update_id: 10,
      message: {
        message_id: 7,
        date: 1_700_000_000,
        text: "Merhaba",
        chat: { id: -100123, type: "supergroup", title: "Group" },
        from: { id: 55, is_bot: false, first_name: "Ayse" },
        ...overrides,
      },
    }),
  );

describe("Telegram webhook receiver", () => {
  it("ingests a text update that carries the account's derived secret", async () => {
    const { s, ingest } = service();
    await expect(receiveTelegramWebhook(s, ACCOUNT_ID, update(), SECRET)).resolves.toEqual({
      ingested: 1,
    });
    expect(ingest).toHaveBeenCalledWith(ACCOUNT_ID, [
      expect.objectContaining({ eventId: "-100123:7", threadId: "-100123", text: "Merhaba" }),
    ]);
  });

  it("refuses a missing, wrong or other-account secret before parsing or ingesting", async () => {
    const { s, ingest } = service();
    await expect(receiveTelegramWebhook(s, ACCOUNT_ID, update(), undefined)).rejects.toThrow(
      "secret",
    );
    await expect(receiveTelegramWebhook(s, ACCOUNT_ID, update(), "x".repeat(43))).rejects.toThrow(
      "secret",
    );
    const otherSecret = telegramWebhookSecret(TOKEN, "00000000-0000-4000-8000-0000000000bb");
    await expect(receiveTelegramWebhook(s, ACCOUNT_ID, update(), otherSecret)).rejects.toThrow(
      "secret",
    );
    expect(ingest).not.toHaveBeenCalled();
  });

  it("ignores channel posts and non-text updates without ingesting", async () => {
    const { s, ingest } = service();
    const channel = Buffer.from(
      JSON.stringify({
        update_id: 11,
        message: {
          message_id: 8,
          date: 1_700_000_000,
          text: "Post",
          chat: { id: -100999, type: "channel", title: "News" },
        },
      }),
    );
    await expect(receiveTelegramWebhook(s, ACCOUNT_ID, channel, SECRET)).resolves.toEqual({
      ingested: 0,
    });
    await expect(
      receiveTelegramWebhook(s, ACCOUNT_ID, Buffer.from(JSON.stringify({ update_id: 12 })), SECRET),
    ).resolves.toEqual({ ingested: 0 });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses an account that is not a connected Telegram bot on this host", async () => {
    const { s, ingest } = service([{ ...bot, accountType: "channel" } as SocialAccount]);
    await expect(receiveTelegramWebhook(s, ACCOUNT_ID, update(), SECRET)).rejects.toThrow(
      "unknown",
    );
    expect(ingest).not.toHaveBeenCalled();
  });
});
