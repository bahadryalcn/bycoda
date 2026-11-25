import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SocialAccount,
  SocialDraft,
  SocialJob,
  SocialThread,
} from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { createSocialAdapters } from "../../../src/integrations/social/platformAdapters";
import { receiveTelegramWebhook } from "./social-webhooks";
import { telegramWebhookSecret } from "../token-connections/telegram";
import type { SocialService } from "../social";
import { fixture, runCleanups } from "../social-test-support";

afterEach(runCleanups);

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
  it("takes an automatic forward from the signed webhook through approved Inbox reply submission", async () => {
    const s = await fixture();
    const account = await s.call<SocialAccount>("accounts.create", {
      platform: "telegram",
      name: "Bycoda discussion bot",
      accountType: "bot",
      connection: "token",
      projectIds: [s.a.id],
    });
    await s.social.connectAccount(
      account.id,
      {
        platformId: "123456",
        name: account.name,
        connection: "token",
        scopes: ["bot.send"],
        accessApproved: true,
      },
      { accessToken: TOKEN },
    );
    await s.call("accounts.grants", {
      accountId: account.id,
      projectId: s.a.id,
      permissions: ["read", "draft", "reply"],
    });
    const root = {
      message_id: 7,
      date: s.clock.value / 1000,
      text: "STOP on the server during the change window",
      chat: { id: -100123, type: "supergroup", title: "Discussion" },
      is_automatic_forward: true,
      forward_origin: { type: "channel", chat: { id: -100999, type: "channel" }, message_id: 5 },
      from: { id: 9, is_bot: true },
    };
    const fetcher = vi.fn(async (url: unknown, _request?: RequestInit) => {
      const method = String(url).split("/").at(-1);
      const result =
        method === "getMe"
          ? { id: 123456, is_bot: true }
          : method === "getChat"
            ? { ...root.chat, linked_chat_id: -100999 }
            : { message_id: 8, chat: root.chat, text: "Reviewed comment", reply_to_message: root };
      return Response.json({ ok: true, result });
    });
    s.adapters.telegram = createSocialAdapters(new SocialHttp(fetcher)).telegram;
    const secret = telegramWebhookSecret(TOKEN, account.id);
    const list = vi.spyOn(s.social, "list");
    await expect(
      receiveTelegramWebhook(s.social, account.id, update(root), secret),
    ).resolves.toEqual({ ingested: 1 });
    await expect(
      receiveTelegramWebhook(s.social, account.id, update(root), secret),
    ).resolves.toEqual({ ingested: 0 });
    expect(list.mock.calls.some(([kind]) => kind === "rule")).toBe(false);
    list.mockRestore();
    const threads = await s.call<SocialThread[]>("inbox.list");
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ platformThreadId: "tg-discussion:-100999:5:-100123:7" });
    const draft = await s.call<SocialDraft>("replies.draft", {
      threadId: threads[0]!.id,
      text: "Reviewed comment",
    });
    await expect(s.call("replies.send", { id: draft.id })).rejects.toThrow(/approval/i);
    await s.approveDraft(draft.id);
    const job = await s.call<SocialJob>("replies.send", { id: draft.id });
    expect(job.payload).toMatchObject({
      recipientId: "-100123",
      threadId: "tg-discussion:-100999:5:-100123:7",
    });
    await s.enable();
    await s.social.tick();
    expect(await s.call("jobs.status", { id: job.id })).toMatchObject({
      status: "succeeded",
      platformId: "-100123:8",
    });
    const sends = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/sendMessage"));
    expect(sends).toHaveLength(1);
    expect(JSON.parse(sends[0]![1]!.body as string)).toMatchObject({
      chat_id: "-100123",
      reply_parameters: { message_id: 7, allow_sending_without_reply: false },
    });
  });

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
