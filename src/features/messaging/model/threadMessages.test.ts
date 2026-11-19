import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "./messagingTypes";
import {
  appendThreadMessage,
  emailReplyAddress,
  isAtThreadEnd,
  extendThreadPage,
  refreshThreadPage,
  sortThreadMessages,
} from "./threadMessages";

function message(id: string, at: number, extra: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    threadId: "t",
    author: "Ada",
    body: "hi",
    at,
    outbound: false,
    attachments: [],
    ...extra,
  };
}

describe("thread messages", () => {
  it("sorts oldest first and keeps the provider order for equal times", () => {
    const sorted = sortThreadMessages([
      message("c", 3),
      message("a", 1),
      message("b1", 2),
      message("b2", 2),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b1", "b2", "c"]);
  });

  it("appends a sent message once", () => {
    const list = [message("a", 1)];
    const sent = message("s", 5, { outbound: true });
    const once = appendThreadMessage(list, sent);
    expect(once.map((entry) => entry.id)).toEqual(["a", "s"]);
    expect(appendThreadMessage(once, sent)).toHaveLength(2);
  });

  it("keeps opened earlier pages and their cursor when a refresh brings only the newest page", () => {
    const loaded = {
      messages: [message("a", 1), message("b", 2), message("c", 3)],
      earlier: "before-a",
    };
    const refreshed = refreshThreadPage(loaded, {
      messages: [message("b", 2), message("c", 3, { body: "edited" }), message("d", 4)],
      earlier: "before-c",
    });
    expect(refreshed.messages.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
    // An unchanged message keeps its object so its rendered row is not rebuilt.
    expect(refreshed.messages[1]).toBe(loaded.messages[1]);
    expect(refreshed.messages[2].body).toBe("edited");
    expect(refreshed.earlier).toBe("before-a");
  });

  it("takes the page cursor when the refresh reaches the oldest loaded message", () => {
    const loaded = { messages: [message("c", 3), message("d", 4)], earlier: "before-c" };
    const refreshed = refreshThreadPage(loaded, {
      messages: [message("b", 2), message("c", 3), message("d", 4)],
      earlier: "before-b",
    });
    expect(refreshed.earlier).toBe("before-b");
    expect(refreshThreadPage(null, { messages: [message("b", 2), message("a", 1)] })).toEqual({
      messages: [message("a", 1), message("b", 2)],
      earlier: null,
    });
  });

  it("keeps a sent message a refresh does not list", () => {
    const loaded = {
      messages: [message("a", 1), message("sent", 9, { outbound: true })],
      earlier: null,
    };
    const refreshed = refreshThreadPage(loaded, { messages: [message("a", 1)] });
    expect(refreshed.messages.map((entry) => entry.id)).toEqual(["a", "sent"]);
  });

  it("prepends an older page once and drops one that answers a stale cursor", () => {
    const loaded = { messages: [message("c", 3), message("d", 4)], earlier: "before-c" };
    const extended = extendThreadPage(loaded, "before-c", {
      messages: [message("a", 1), message("b", 2)],
      earlier: "before-a",
    });
    expect(extended?.messages.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
    expect(extended?.earlier).toBe("before-a");
    expect(extendThreadPage(loaded, "something-else", { messages: [message("a", 1)] })).toBeNull();
    const last = extendThreadPage(loaded, "before-c", { messages: [message("b", 2)] });
    expect(last?.earlier).toBeNull();
  });

  it("replies to the newest inbound sender address", () => {
    expect(
      emailReplyAddress([
        message("a", 1, { authorAddress: "old@example.com" }),
        message("b", 2, { authorAddress: "new@example.com" }),
        message("c", 3, { outbound: true, authorAddress: "me@example.com" }),
      ]),
    ).toBe("new@example.com");
    expect(emailReplyAddress([message("a", 1)])).toBeNull();
    expect(emailReplyAddress(null)).toBeNull();
  });

  it("follows new messages only while the reader is near the end", () => {
    expect(isAtThreadEnd({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })).toBe(true);
    expect(isAtThreadEnd({ scrollHeight: 1000, scrollTop: 937, clientHeight: 0 })).toBe(true);
    expect(isAtThreadEnd({ scrollHeight: 1000, scrollTop: 936, clientHeight: 0 })).toBe(false);
    expect(isAtThreadEnd({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })).toBe(false);
  });
});
