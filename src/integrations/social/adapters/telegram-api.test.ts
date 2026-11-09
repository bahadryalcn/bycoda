import { describe, expect, it, vi } from "vitest";
import { SocialHttp, SocialPlatformError } from "../adapter";
import {
  deleteTelegramMessage,
  deleteTelegramWebhook,
  editTelegramMessage,
  keyboardMarkup,
  parseTelegramPlatformId,
  pollBody,
  sendTelegramButtons,
  sendTelegramPoll,
  setTelegramPinned,
  setTelegramWebhook,
} from "./telegram-api";

const TOKEN = "123:synthetic-token";
const SECRET = "s".repeat(43);
const respond = (result: unknown) =>
  vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ ok: true, result }));
const methodOf = (fetcher: ReturnType<typeof respond>) =>
  String(fetcher.mock.calls[0]![0]).split("/").at(-1);
const bodyOf = (fetcher: ReturnType<typeof respond>) =>
  JSON.parse(fetcher.mock.calls[0]![1]!.body as string);

describe("Telegram Bot API operations", () => {
  it("sends a regular anonymous poll to a chat and confirms the same chat", async () => {
    const fetcher = respond({ message_id: 5, chat: { id: -100123 }, poll: { id: "p" } });
    const http = new SocialHttp(fetcher);
    expect(
      await sendTelegramPoll(http, TOKEN, "-100123", { question: "Ship?", options: ["Yes", "No"] }),
    ).toEqual({ platformId: "-100123:5" });
    expect(methodOf(fetcher)).toBe("sendPoll");
    expect(bodyOf(fetcher)).toEqual({
      chat_id: "-100123",
      question: "Ship?",
      options: ["Yes", "No"],
      type: "regular",
      is_anonymous: true,
    });
  });

  it("refuses polls outside the option and length bounds before any request", async () => {
    const fetcher = respond({});
    const http = new SocialHttp(fetcher);
    const tooMany = Array.from({ length: 11 }, (_, index) => `option ${index}`);
    expect(() => pollBody({ question: "One", options: ["Only"] })).toThrow(SocialPlatformError);
    expect(() => pollBody({ question: "  ", options: ["A", "B"] })).toThrow(SocialPlatformError);
    expect(() => pollBody({ question: "Many", options: tooMany })).toThrow(SocialPlatformError);
    expect(() => pollBody({ question: "Long", options: ["x".repeat(101), "y"] })).toThrow(
      SocialPlatformError,
    );
    await expect(
      sendTelegramPoll(http, TOKEN, "42", { question: "One", options: ["Only"] }),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends inline buttons with callback data and HTTPS links", async () => {
    const fetcher = respond({ message_id: 6, chat: { id: 42 }, text: "Pick" });
    await sendTelegramButtons(new SocialHttp(fetcher), TOKEN, "42", "Pick", [
      [
        { text: "Yes", callbackData: "yes" },
        { text: "Docs", url: "https://example.test/docs" },
      ],
    ]);
    expect(methodOf(fetcher)).toBe("sendMessage");
    expect(bodyOf(fetcher).reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "Yes", callback_data: "yes" },
          { text: "Docs", url: "https://example.test/docs" },
        ],
      ],
    });
  });

  it("rejects oversized callback data, non-HTTPS links and empty keyboards", () => {
    expect(() => keyboardMarkup([[{ text: "x", callbackData: "a".repeat(65) }]])).toThrow(
      SocialPlatformError,
    );
    expect(() => keyboardMarkup([[{ text: "x", url: "http://example.test" }]])).toThrow(
      SocialPlatformError,
    );
    expect(() =>
      keyboardMarkup([[{ text: "x", url: "https://user:secret@example.test" }]]),
    ).toThrow(SocialPlatformError);
    expect(() => keyboardMarkup([])).toThrow(SocialPlatformError);
  });

  it("parses only canonical chat and message identifiers", () => {
    expect(parseTelegramPlatformId("-100123:7")).toEqual({ chatId: "-100123", messageId: 7 });
    for (const value of ["123", "123:0", "abc:1", "123:7:8", "01:7"])
      expect(() => parseTelegramPlatformId(value)).toThrow(SocialPlatformError);
  });

  it("edits a message only when the acknowledgement names the same message and chat", async () => {
    const fetcher = respond({ message_id: 7, chat: { id: 42 } });
    expect(await editTelegramMessage(new SocialHttp(fetcher), TOKEN, "42:7", "New text")).toEqual({
      platformId: "42:7",
    });
    expect(methodOf(fetcher)).toBe("editMessageText");
    expect(bodyOf(fetcher)).toEqual({ chat_id: "42", message_id: 7, text: "New text" });

    const mismatch = respond({ message_id: 8, chat: { id: 42 } });
    await expect(
      editTelegramMessage(new SocialHttp(mismatch), TOKEN, "42:7", "New text"),
    ).rejects.toMatchObject({ code: "unknown" });
  });

  it("deletes and pins only on a true acknowledgement", async () => {
    await expect(
      deleteTelegramMessage(new SocialHttp(respond(true)), TOKEN, "42:7"),
    ).resolves.toBeUndefined();
    await expect(
      deleteTelegramMessage(new SocialHttp(respond(false)), TOKEN, "42:7"),
    ).rejects.toMatchObject({ code: "unknown" });

    const pin = respond(true);
    await setTelegramPinned(new SocialHttp(pin), TOKEN, "42:7", true);
    expect(methodOf(pin)).toBe("pinChatMessage");
    expect(bodyOf(pin)).toEqual({ chat_id: "42", message_id: 7, disable_notification: true });

    const unpin = respond(true);
    await setTelegramPinned(new SocialHttp(unpin), TOKEN, "42:7", false);
    expect(methodOf(unpin)).toBe("unpinChatMessage");
  });

  it("registers a webhook with its secret over HTTPS on the accepted ports only", async () => {
    const fetcher = respond(true);
    await setTelegramWebhook(
      new SocialHttp(fetcher),
      TOKEN,
      "https://bycoda.example.test/hooks/telegram",
      SECRET,
    );
    expect(methodOf(fetcher)).toBe("setWebhook");
    expect(bodyOf(fetcher)).toEqual({
      url: "https://bycoda.example.test/hooks/telegram",
      secret_token: SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    for (const url of [
      "http://bycoda.example.test/hooks/telegram",
      "https://user:pw@bycoda.example.test/hooks/telegram",
      "https://bycoda.example.test:8080/hooks/telegram",
      "not a url",
    ])
      await expect(
        setTelegramWebhook(new SocialHttp(respond(true)), TOKEN, url, SECRET),
      ).rejects.toMatchObject({ code: "rejected" });
    await expect(
      setTelegramWebhook(
        new SocialHttp(respond(true)),
        TOKEN,
        "https://bycoda.example.test/hooks/telegram",
        "short",
      ),
    ).rejects.toMatchObject({ code: "rejected" });
  });

  it("removes the webhook without dropping pending updates", async () => {
    const fetcher = respond(true);
    await deleteTelegramWebhook(new SocialHttp(fetcher), TOKEN);
    expect(methodOf(fetcher)).toBe("deleteWebhook");
    expect(bodyOf(fetcher)).toEqual({ drop_pending_updates: false });
  });

  it("never exposes the bot token when the transport fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error(`https://api.telegram.org/bot${TOKEN}/sendPoll`);
    });
    const error = await sendTelegramPoll(new SocialHttp(fetcher), TOKEN, "42", {
      question: "Ship?",
      options: ["Yes", "No"],
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "unknown" });
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });
});
