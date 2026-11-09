import { describe, expect, it, vi } from "vitest";
import type { Interaction, SocialPerson } from "../../../src/features/social/model/audience";
import { inboxReplyOptions, inboxTimeline } from "./inbox-thread-ops";
import { account, capability, contact, inboxContext, thread } from "./inbox-test-support";

vi.mock("../../../src/integrations/social/capabilities", () => ({
  accountCapabilities: (item: { caps: unknown[] }) => item.caps,
}));

const all = [capability("reply"), capability("message.reply"), capability("inbox.read")];
const NOW = 1_000_000;
const DAY = 24 * 60 * 60_000;

describe("inbox.replyOptions", () => {
  const accounts = [account("wa-main", "whatsapp", all), account("tg-main", "telegram", all)];
  const contacts = [
    contact("c-wa", "wa-main", "905551", "Ayse"),
    contact("c-tg", "tg-main", "77", "Can"),
  ];

  it("allows a reply inside the platform window", async () => {
    const { ctx } = inboxContext({
      accounts,
      contacts,
      now: NOW,
      threads: [
        thread({
          id: "t1",
          accountId: "wa-main",
          contactId: "c-wa",
          kind: "message",
          replyUntil: NOW + DAY,
        }),
      ],
    });
    expect(await inboxReplyOptions(ctx, { threadId: "t1" })).toEqual({ canReply: true });
  });

  it("reports the expired 24-hour window with a template-only answer", async () => {
    const { ctx } = inboxContext({
      accounts,
      contacts,
      now: NOW,
      threads: [
        thread({
          id: "t1",
          accountId: "wa-main",
          contactId: "c-wa",
          kind: "message",
          replyUntil: NOW - 1,
        }),
      ],
    });
    expect(await inboxReplyOptions(ctx, { threadId: "t1" })).toEqual({
      canReply: false,
      templatesOnly: true,
      reasonCode: "window.expired",
      reason: "24-hour window passed; only a template can be sent",
    });
  });

  it("does not apply the 24-hour window to platforms without one", async () => {
    const { ctx } = inboxContext({
      accounts,
      contacts,
      now: NOW,
      threads: [
        thread({
          id: "t2",
          accountId: "tg-main",
          contactId: "c-tg",
          kind: "message",
          replyUntil: NOW - 1,
        }),
      ],
    });
    expect((await inboxReplyOptions(ctx, { threadId: "t2" })).canReply).toBe(true);
  });

  it("blocks a conversation the platform marked as not replyable, with the platform reason", async () => {
    const { ctx } = inboxContext({
      accounts,
      contacts,
      now: NOW,
      threads: [thread({ id: "t3", accountId: "tg-main", contactId: "c-tg", replyAllowed: false })],
    });
    expect(await inboxReplyOptions(ctx, { threadId: "t3" })).toEqual({
      canReply: false,
      reasonCode: "platform.reply_not_allowed",
      reason: "The platform does not allow replies to this conversation.",
    });
  });

  it("passes the capability reason through when the reply operation is unavailable", async () => {
    const blocked = account("li-main", "linkedin", [
      capability("reply", "unsupported", "browser.no_recipe", "No automated recipe"),
    ]);
    const { ctx } = inboxContext({
      accounts: [blocked],
      contacts: [contact("c-li", "li-main", "li-1", "Lena")],
      now: NOW,
      threads: [thread({ id: "t4", accountId: "li-main", contactId: "c-li", kind: "comment" })],
    });
    expect(await inboxReplyOptions(ctx, { threadId: "t4" })).toEqual({
      canReply: false,
      reasonCode: "browser.no_recipe",
      reason: "No automated recipe",
    });
  });
});

describe("inbox.timeline", () => {
  const interaction = (overrides: Partial<Interaction>): Interaction =>
    ({
      id: "i",
      personId: "person-1",
      accountId: "x-main",
      platform: "x",
      kind: "message",
      at: 0,
      direction: "inbound",
      text: "",
      ...overrides,
    }) as Interaction;

  it("orders one person's events across handles and stored interactions, oldest first", async () => {
    const person = {
      id: "person-1",
      name: "Ana",
      handles: [
        { accountId: "x-main", platform: "x", platformId: "ana-x", contactId: "c-ana" },
        { accountId: "ig-main", platform: "instagram", platformId: "bo-ig", contactId: "c-bo" },
      ],
    } as unknown as SocialPerson;
    const { ctx } = inboxContext({
      accounts: [account("x-main", "x", all), account("ig-main", "instagram", all)],
      contacts: [
        contact("c-ana", "x-main", "ana-x", "Ana"),
        contact("c-bo", "ig-main", "bo-ig", "Ana (IG)"),
      ],
      persons: [person],
      threads: [
        thread({
          id: "tx",
          accountId: "x-main",
          contactId: "c-ana",
          events: [
            { id: "x1", text: "Price?", at: 100, direction: "inbound", platformId: "p1" },
            { id: "x2", text: "Sent", at: 300, direction: "outbound", platformId: "p2" },
          ],
        }),
        thread({
          id: "ti",
          accountId: "ig-main",
          contactId: "c-bo",
          kind: "comment",
          events: [{ id: "g1", text: "Nice", at: 200, direction: "inbound", platformId: "p3" }],
        }),
      ],
      interactions: [
        interaction({ id: "i-old", at: 50, text: "Earlier", accountId: "x-main" }),
        // Same message as thread event x1: must not appear twice.
        interaction({ id: "i-dup", at: 100, text: "Price?", accountId: "x-main" }),
        // Account the owner cannot read: must not appear.
        interaction({ id: "i-hidden", at: 400, text: "Secret", accountId: "other-x" }),
      ],
    });
    const timeline = await inboxTimeline(ctx, { personId: "person-1" });
    expect(timeline.events.map((event) => event.text)).toEqual([
      "Earlier",
      "Price?",
      "Nice",
      "Sent",
    ]);
    expect(timeline.events.map((event) => event.kind)).toEqual([
      "interaction",
      "message",
      "comment",
      "message",
    ]);
    expect(timeline.truncated).toBe(false);
  });

  it("rejects an unknown person", async () => {
    const { ctx } = inboxContext();
    await expect(inboxTimeline(ctx, { personId: "missing" })).rejects.toThrow("Person not found.");
  });
});
