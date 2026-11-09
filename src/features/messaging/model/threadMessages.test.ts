import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "./messagingTypes";
import { appendThreadMessage, emailReplyAddress, sortThreadMessages } from "./threadMessages";

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
});
