import { describe, expect, it } from "vitest";
import { parseTelegramUpdate, verifyTelegramSecret } from "./telegram-webhook";

const SECRET = "b".repeat(43);
const direct = {
  message_id: 3,
  date: 100,
  text: "Hi",
  chat: { id: 42, type: "private", first_name: "Ana", username: "ana_x" },
  from: { id: 42, is_bot: false },
};

describe("parseTelegramUpdate", () => {
  it("returns a direct text message with a chat-scoped identity", () => {
    expect(parseTelegramUpdate({ update_id: 10, message: direct })).toEqual({
      event: {
        eventId: "42:3",
        threadId: "42",
        contactId: "42",
        contactName: "Ana",
        kind: "message",
        text: "Hi",
        at: 100_000,
      },
      privateChat: true,
      username: "ana_x",
    });
  });

  it("marks groups as not direct and keeps their messages distinct", () => {
    const parsed = parseTelegramUpdate({
      update_id: 11,
      message: { ...direct, message_id: 4, chat: { id: -55, type: "group", title: "Team" } },
    });
    expect(parsed).toMatchObject({
      event: { threadId: "-55", contactName: "Team" },
      privateChat: false,
    });
    expect(parsed?.username).toBeUndefined();
  });

  it("falls back to the username when a private chat has no first name", () => {
    const parsed = parseTelegramUpdate({
      update_id: 12,
      message: { ...direct, chat: { id: 42, type: "private", username: "ana_x" } },
    });
    expect(parsed?.event.contactName).toBe("ana_x");
  });

  it.each([
    ["channel posts", { update_id: 1, channel_post: direct }],
    ["bot senders", { update_id: 2, message: { ...direct, from: { id: 9, is_bot: true } } }],
    [
      "channel chats",
      { update_id: 3, message: { ...direct, chat: { id: -100, type: "channel" } } },
    ],
    ["messages without text", { update_id: 4, message: { ...direct, text: undefined } }],
    ["blank text", { update_id: 5, message: { ...direct, text: "   " } }],
    ["zero message IDs", { update_id: 6, message: { ...direct, message_id: 0 } }],
    ["non-integer dates", { update_id: 7, message: { ...direct, date: 1.5 } }],
    ["non-object updates", "not an update"],
    ["null updates", null],
  ])("ignores %s without throwing", (_label, raw) => {
    expect(parseTelegramUpdate(raw)).toBeUndefined();
  });
});

describe("verifyTelegramSecret", () => {
  it("accepts only the exact expected secret", () => {
    expect(verifyTelegramSecret(SECRET, SECRET)).toBe(true);
    expect(verifyTelegramSecret("c".repeat(43), SECRET)).toBe(false);
    expect(verifyTelegramSecret(SECRET.slice(1), SECRET)).toBe(false);
    expect(verifyTelegramSecret(`${SECRET}x`, SECRET)).toBe(false);
  });

  it("refuses a missing header, a malformed header and a malformed expected secret", () => {
    expect(verifyTelegramSecret(undefined, SECRET)).toBe(false);
    expect(verifyTelegramSecret(["a"], SECRET)).toBe(false);
    expect(verifyTelegramSecret("has spaces in it and is long enough!!", SECRET)).toBe(false);
    expect(verifyTelegramSecret(SECRET, "short")).toBe(false);
  });
});
