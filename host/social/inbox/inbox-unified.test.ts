import { describe, expect, it, vi } from "vitest";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { SocialPrincipal } from "../social";
import { parseUnifiedInput, setInboxStatus, unifiedInbox } from "./inbox-unified";
import { account, capability, contact, inboxContext, thread } from "./inbox-test-support";

// Capability rows come from each fixture account, so the test controls readability directly.
vi.mock("../../../src/integrations/social/capabilities", () => ({
  accountCapabilities: (item: { caps: unknown[] }) => item.caps,
}));

const readable = [capability("inbox.read"), capability("comments.read")];
const event = (id: string, at: number, direction: "inbound" | "outbound", text = "hello") => ({
  id,
  text,
  at,
  direction,
  platformId: `platform-${id}`,
});

function fixture() {
  const x = account("x-main", "x", readable, { p1: ["read"] });
  const ig = account("ig-main", "instagram", readable, { p1: ["read"] });
  const contacts = [
    contact("c-ana", "x-main", "ana-x", "Ana"),
    contact("c-bo", "ig-main", "bo-ig", "Bo"),
    contact("c-cem", "x-main", "cem-x", "Cem"),
  ];
  const threads = [
    thread({
      id: "t-msg",
      accountId: "x-main",
      contactId: "c-ana",
      kind: "message",
      events: [event("e1", 300, "inbound", "Price?")],
    }),
    thread({
      id: "t-comment",
      accountId: "ig-main",
      contactId: "c-bo",
      kind: "comment",
      events: [event("e2", 500, "inbound", "Love it")],
    }),
    thread({
      id: "t-old",
      accountId: "x-main",
      contactId: "c-cem",
      kind: "comment",
      events: [event("e3", 100, "outbound", "Thanks")],
    }),
  ];
  const persons: SocialPerson[] = [
    {
      id: "person-ana",
      name: "Ana Person",
      handles: [{ accountId: "x-main", platform: "x", platformId: "ana-x", contactId: "c-ana" }],
    } as unknown as SocialPerson,
  ];
  return { accounts: [x, ig], contacts, threads, persons };
}

describe("inbox.unified", () => {
  it("merges comments and messages from every account into one newest-first list", async () => {
    const { ctx } = inboxContext(fixture());
    const page = await unifiedInbox(ctx, {});
    expect(page.items.map((item) => item.threadId)).toEqual(["t-comment", "t-msg", "t-old"]);
    expect(page.items.map((item) => item.platform)).toEqual(["instagram", "x", "x"]);
    expect(page.items.map((item) => item.kind)).toEqual(["comment", "message", "comment"]);
    expect(page.items[1].person).toEqual({ id: "person-ana", name: "Ana Person" });
    expect(page.items[0].person).toBeUndefined();
    expect(page.next).toBeUndefined();
  });

  it("pages with a cursor and reports no next page after the last item", async () => {
    const { ctx } = inboxContext(fixture());
    const first = await unifiedInbox(ctx, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next).toBe("300|t-msg");
    const second = await unifiedInbox(ctx, { limit: 2, cursor: first.next });
    expect(second.items.map((item) => item.threadId)).toEqual(["t-old"]);
    expect(second.next).toBeUndefined();
  });

  it("lists an account with no readable channel as unreadable and skips partly readable ones", async () => {
    const blocked = account("li-main", "linkedin", [
      capability("inbox.read", "unsupported", "browser.no_recipe", "No recipe"),
      capability("comments.read", "unsupported", "browser.no_recipe", "No recipe"),
    ]);
    const partly = account("tg-main", "telegram", [
      capability("inbox.read", "available"),
      capability("comments.read", "unsupported", "unsupported.not_yet", "Later"),
    ]);
    const { ctx } = inboxContext({
      ...fixture(),
      accounts: [...fixture().accounts, blocked, partly],
    });
    const page = await unifiedInbox(ctx, {});
    expect(page.unreadable).toEqual([
      {
        accountId: "li-main",
        platform: "linkedin",
        reasonCode: "browser.no_recipe",
        reason: "No recipe",
      },
    ]);
  });

  it("derives unread or replied from the last event, then keeps the saved status and tags", async () => {
    const { ctx, statuses } = inboxContext(fixture());
    const before = await unifiedInbox(ctx, {});
    expect(before.items.find((item) => item.threadId === "t-old")?.status).toBe("replied");
    expect(before.items.find((item) => item.threadId === "t-msg")?.status).toBe("unread");

    await setInboxStatus(ctx, { threadId: "t-msg", status: "done", tags: ["vip"] });
    expect(statuses.get("t-msg")).toMatchObject({ status: "done", tags: ["vip"] });

    const done = await unifiedInbox(ctx, { filter: { status: "done" } });
    expect(done.items.map((item) => item.threadId)).toEqual(["t-msg"]);
    expect(done.items[0].tags).toEqual(["vip"]);

    const byTag = await unifiedInbox(ctx, { filter: { query: "VIP" } });
    expect(byTag.items.map((item) => item.threadId)).toEqual(["t-msg"]);
  });

  it("keeps the existing tags when a status change sends no tags", async () => {
    const { ctx, statuses } = inboxContext(fixture());
    await setInboxStatus(ctx, { threadId: "t-msg", status: "assigned", tags: ["sales"] });
    await setInboxStatus(ctx, { threadId: "t-msg", status: "replied" });
    expect(statuses.get("t-msg")).toMatchObject({ status: "replied", tags: ["sales"] });
  });

  it("shows a project principal only the conversations of its project on readable accounts", async () => {
    const principal: SocialPrincipal = {
      kind: "session",
      actorId: "session-1",
      provider: "test",
      projectId: "p1",
    };
    const base = fixture();
    const threads = [
      thread({
        id: "mine",
        accountId: "x-main",
        contactId: "c-ana",
        projectId: "p1",
        events: [event("m1", 10, "inbound")],
      }),
      thread({
        id: "other-project",
        accountId: "x-main",
        contactId: "c-ana",
        projectId: "p2",
        events: [event("m2", 20, "inbound")],
      }),
      thread({
        id: "no-grant",
        accountId: "ig-main",
        contactId: "c-bo",
        projectId: "p1",
        events: [event("m3", 30, "inbound")],
      }),
    ];
    const { ctx } = inboxContext({
      ...base,
      accounts: [
        account("x-main", "x", readable, { p1: ["read"] }),
        account("ig-main", "instagram", readable),
      ],
      threads,
      principal,
    });
    const page = await unifiedInbox(ctx, {});
    expect(page.items.map((item) => item.threadId)).toEqual(["mine"]);
  });

  it("refuses to change the status of a conversation the principal cannot see", async () => {
    const principal: SocialPrincipal = {
      kind: "session",
      actorId: "session-1",
      provider: "test",
      projectId: "p1",
    };
    const { ctx } = inboxContext({
      ...fixture(),
      principal,
      threads: [
        thread({ id: "foreign", accountId: "x-main", contactId: "c-ana", projectId: "p2" }),
      ],
    });
    await expect(setInboxStatus(ctx, { threadId: "foreign", status: "done" })).rejects.toThrow(
      "Conversation not found.",
    );
  });

  it("rejects unknown filter fields, unknown statuses and malformed cursors", () => {
    expect(() => parseUnifiedInput({ filter: { owner: "x" } })).toThrow();
    expect(() => parseUnifiedInput({ filter: { status: "archived" } })).toThrow(
      "Invalid inbox status.",
    );
    expect(() => parseUnifiedInput({ cursor: "not-a-cursor" })).toThrow("Invalid inbox cursor.");
    expect(() => parseUnifiedInput({ limit: 500 })).toThrow();
    expect(parseUnifiedInput({}).limit).toBe(50);
  });

  it("rejects a status change that has no status", async () => {
    const { ctx } = inboxContext(fixture());
    await expect(setInboxStatus(ctx, { threadId: "t-msg" })).rejects.toThrow(
      "Invalid inbox status.",
    );
  });
});
