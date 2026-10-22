import { describe, expect, it } from "vitest";
import {
  parseXBrowserInbox,
  parseXBrowserMentions,
  parseXBrowserMessageSent,
} from "./social-browser-inbound";

const now = Date.parse("2026-10-19T00:00:00Z");
const tweet = (id: string, author: string, patch: Record<string, unknown> = {}) => ({
  legacy: {
    id_str: id,
    user_id_str: author,
    full_text: "Tell me about bycoda",
    created_at: new Date(now - 1000).toUTCString(),
    entities: { user_mentions: [{ id_str: "42" }] },
    ...patch,
  },
});
const dm = (
  id = "90",
  sender = "7",
  recipient = "42",
  thread = "7-42",
  text = "How does it work?",
) => ({
  message: {
    conversation_id: thread,
    time: String(now - 1000),
    message_data: { id, sender_id: sender, recipient_id: recipient, text },
  },
});

describe("bounded X browser inbound decoding", () => {
  it("accepts exact mentions and replies to owned posts, skips own/unrelated posts and deduplicates", () => {
    const value = {
      data: {
        timeline: {
          instructions: [
            {
              entries: [
                tweet("1", "7"),
                tweet("1", "7"),
                tweet("2", "42"),
                tweet("3", "9", { entities: { user_mentions: [] } }),
                tweet("4", "10", { entities: {}, in_reply_to_status_id_str: "100" }),
              ],
            },
          ],
        },
      },
    };
    const events = parseXBrowserMentions(JSON.stringify(value), "42", ["100"], now);
    expect(events.map((event) => event.eventId).sort()).toEqual(["1", "4"]);
    expect(events).toContainEqual(
      expect.objectContaining({ contactId: "7", postId: "1", kind: "comment" }),
    );
  });
  it("distinguishes recognized empty timelines from encrypted or changed schemas", () => {
    expect(parseXBrowserMentions('{"global_objects":{"tweets":{}}}', "42", [], now)).toEqual([]);
    expect(() => parseXBrowserMentions('{"data":{"encrypted":true}}', "42", [], now)).toThrowError(
      expect.objectContaining({ code: "unsupported" }),
    );
    expect(() => parseXBrowserInbox('{"encrypted":true}', "42", now)).toThrowError(
      expect.objectContaining({ code: "unsupported" }),
    );
  });
  it("rejects malformed, excessive, unauthenticated and rate-limited responses without returning their text", () => {
    expect(() => parseXBrowserMentions("invalid", "42", [], now)).toThrowError(
      expect.objectContaining({ code: "rejected" }),
    );
    expect(() =>
      parseXBrowserMentions(
        JSON.stringify({ errors: [{ code: 89, message: "synthetic secret" }] }),
        "42",
        [],
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: "expired" }));
    expect(() => parseXBrowserMentions('{"errors":[{"code":88}]}', "42", [], now)).toThrowError(
      expect.objectContaining({ code: "rate_limit", retryAt: now + 900000 }),
    );
    expect(() =>
      parseXBrowserMentions(
        JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) }),
        "42",
        [],
        now,
      ),
    ).toThrow();
    expect(() =>
      parseXBrowserMentions(JSON.stringify({ data: Array(30000).fill(0) }), "42", [], now),
    ).toThrow();
  });
  it("rejects future timestamps and never uses names as canonical identities", () => {
    const value = {
      global_objects: {
        tweets: {
          a: tweet("8", "7", { created_at: new Date(now + 120000).toUTCString() }),
          b: tweet("9", "not-a-numeric-id"),
        },
      },
    };
    expect(parseXBrowserMentions(JSON.stringify(value), "42", [], now)).toEqual([]);
  });
  it("accepts only inbound DMs addressed to this account and the exact conversation participants", () => {
    const value = {
      inbox_initial_state: {
        entries: [
          dm(),
          dm(),
          dm("91", "42", "7"),
          dm("92", "7", "99"),
          dm("93", "7", "42", "7-99"),
        ],
      },
    };
    expect(parseXBrowserInbox(JSON.stringify(value), "42", now)).toEqual([
      expect.objectContaining({
        eventId: "90",
        threadId: "7-42",
        contactId: "7",
        text: "How does it work?",
      }),
    ]);
    expect(parseXBrowserInbox('{"inbox_initial_state":{"entries":[]}}', "42", now)).toEqual([]);
  });
  it("confirms outgoing DM ID only with matching sender, recipient and exact message text", () => {
    const value = {
      event: {
        id: "99",
        message_create: {
          sender_id: "42",
          target: { recipient_id: "7" },
          message_data: { text: "hello" },
        },
      },
    };
    expect(parseXBrowserMessageSent(JSON.stringify(value), "42", "7", "hello", now)).toEqual({
      platformId: "99",
    });
    expect(
      parseXBrowserMessageSent(
        JSON.stringify({ entries: [dm("99", "42", "7", "7-42", "hello")] }),
        "42",
        "7",
        "hello",
        now,
      ),
    ).toEqual({ platformId: "99" });
    expect(() =>
      parseXBrowserMessageSent(JSON.stringify(value), "42", "8", "hello", now),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
    expect(() =>
      parseXBrowserMessageSent(JSON.stringify(value), "42", "7", "changed", now),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
  });
});
