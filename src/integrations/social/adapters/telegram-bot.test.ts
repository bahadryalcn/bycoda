import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../features/social/model/social";
import { SocialHttp } from "../adapter";
import { createTelegramAdapter } from "./telegram-bot";

const TOKEN = "123:synthetic-token";
const account = (): SocialAccount => ({
  id: "bot",
  platform: "telegram",
  platformId: "123",
  name: "Bot",
  accountType: "bot",
  connection: "token",
  scopes: ["bot.send", "bot.poll"],
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const update = (
  updateId: number,
  messageId: number,
  chat: Record<string, unknown>,
  date = 100,
) => ({
  update_id: updateId,
  message: {
    message_id: messageId,
    date,
    text: `text ${updateId}`,
    chat,
    from: { id: 42, is_bot: false },
  },
});
const jsonResponse = (result: unknown) =>
  vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ ok: true, result }));

describe("Telegram bot adapter", () => {
  it("collects private senders only, keeps the latest contact and never confirms updates", async () => {
    const fetcher = jsonResponse([
      update(10, 1, { id: 42, type: "private", first_name: "Ana", username: "ana_x" }, 100),
      update(11, 2, { id: 42, type: "private", first_name: "Ana", username: "ana_x" }, 200),
      update(12, 3, { id: -55, type: "group", title: "Team" }, 300),
      update(13, 4, { id: 77, type: "private", first_name: "Bo" }, 150),
    ]);
    const adapter = createTelegramAdapter(new SocialHttp(fetcher));
    const result = await adapter.collectAudience!(account(), TOKEN, {
      kind: "dm_senders",
      accountId: "bot",
    });
    expect(result.next).toBeUndefined();
    expect(result.people).toEqual([
      {
        platformId: "42",
        name: "Ana",
        username: "ana_x",
        kind: "dm",
        ref: "42:2",
        at: 200_000,
      },
      { platformId: "77", name: "Bo", kind: "dm", ref: "77:4", at: 150_000 },
    ]);
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ offset: 0, allowed_updates: ["message"] });
  });

  it("refuses audience sources it does not collect, without a request", async () => {
    const fetcher = jsonResponse([]);
    const adapter = createTelegramAdapter(new SocialHttp(fetcher));
    await expect(
      adapter.collectAudience!(account(), TOKEN, { kind: "followers", accountId: "bot" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      adapter.collectAudience!(account(), TOKEN, { kind: "dm_senders", accountId: "other" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("deletes a bot message by its stored chat and message identifier", async () => {
    const fetcher = jsonResponse(true);
    const adapter = createTelegramAdapter(new SocialHttp(fetcher));
    await adapter.deletePost!(account(), TOKEN, "42:7");
    expect(String(fetcher.mock.calls[0]![0]).endsWith("/deleteMessage")).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      chat_id: "42",
      message_id: 7,
    });
    await expect(adapter.deletePost!(account(), TOKEN, "42")).rejects.toMatchObject({
      code: "rejected",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports health from getMe and maps an expired token to expired", async () => {
    const healthy = createTelegramAdapter(
      new SocialHttp(jsonResponse({ id: 123, is_bot: true, username: "bot" })),
    );
    await expect(healthy.healthCheck!(account(), TOKEN)).resolves.toEqual({ ok: true });

    const expired = createTelegramAdapter(
      new SocialHttp(
        vi.fn(
          async () => new Response(JSON.stringify({ ok: false, error_code: 401 }), { status: 401 }),
        ),
      ),
    );
    await expect(expired.healthCheck!(account(), TOKEN)).resolves.toEqual({
      ok: false,
      code: "expired",
    });
  });

  it("keeps the existing poll cursor semantics", async () => {
    const fetcher = jsonResponse([update(10, 1, { id: 42, type: "private" })]);
    const result = await createTelegramAdapter(new SocialHttp(fetcher)).poll(
      account(),
      TOKEN,
      [],
      "10",
    );
    expect(result.cursor).toBe("11");
    expect(result.events).toHaveLength(1);
  });
});
