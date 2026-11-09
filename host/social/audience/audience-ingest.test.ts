import { describe, expect, it } from "vitest";
import type { CaptureRule } from "../../../src/features/social/model/audience";
import type { Sequence } from "../../../src/features/social/model/outreach";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import { linkInboundToPeople } from "./audience-ingest";
import { personIdFor } from "./audience-person";
import { account, contactOf, fixture, NOW } from "./audience-test-support";
import {
  SYSTEM_COMMENTERS_LIST_ID,
  SYSTEM_COMMENTERS_RULE_ID,
} from "../store/social-audience-store";

const contact = contactOf("acc-x", "u1", { name: "Ada" });

function comment(eventId: string, text: string): SocialInbound {
  return {
    eventId,
    threadId: "thread-1",
    contactId: contact.id,
    contactName: "Ada",
    kind: "comment",
    text,
    at: NOW,
    postId: "post-1",
  };
}

function rule(id: string, patch: Partial<CaptureRule> = {}): CaptureRule {
  return {
    id,
    name: id,
    enabled: true,
    source: { kind: "own_post_comments", accountId: "acc-x" },
    filter: {},
    targetListId: "list-kw",
    createdAt: NOW,
    ...patch,
  };
}

async function members(store: Awaited<ReturnType<typeof fixture>>["store"], listId: string) {
  return (await store.listMembers(listId)).personIds;
}

describe("inbound people linking", () => {
  it("keeps the system Commenters rule off by default and only records the person and interaction", async () => {
    const f = await fixture();
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e1", "hi")],
      [contact],
    );
    const personId = personIdFor("acc-x", "u1");
    expect(await f.store.getPerson(personId)).toBeDefined();
    expect(await members(f.store, SYSTEM_COMMENTERS_LIST_ID)).toEqual([]);
    expect((await f.store.listInteractions(personId)).map((item) => item.kind)).toEqual([
      "comment",
    ]);
  });

  it("adds commenters to the system list once the rule is enabled, and only once", async () => {
    const f = await fixture();
    const system = await f.store.getRecord("capture-rule", SYSTEM_COMMENTERS_RULE_ID);
    await f.store.putRecord("capture-rule", SYSTEM_COMMENTERS_RULE_ID, {
      ...system!,
      enabled: true,
    });
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e1", "hi")],
      [contact],
    );
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e2", "again")],
      [contact],
    );
    expect(await members(f.store, SYSTEM_COMMENTERS_LIST_ID)).toEqual([personIdFor("acc-x", "u1")]);
  });

  it("applies keyword and language filters", async () => {
    const f = await fixture();
    await f.store.putList({
      id: "list-kw",
      name: "Price",
      kind: "static",
      projectIds: ["p1"],
      createdAt: NOW,
    });
    await f.store.putRecord(
      "capture-rule",
      "r-kw",
      rule("r-kw", { filter: { keywords: ["price"] } }),
    );
    await f.store.putRecord(
      "capture-rule",
      "r-tr",
      rule("r-tr", { filter: { language: "tr" }, targetListId: "list-kw" }),
    );
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e1", "hello")],
      [contact],
    );
    expect(await members(f.store, "list-kw")).toEqual([]);
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e2", "What is the PRICE?")],
      [contact],
    );
    expect(await members(f.store, "list-kw")).toEqual([personIdFor("acc-x", "u1")]);
  });

  it("never adds a suppressed person to a list or starts a sequence for them", async () => {
    const f = await fixture();
    await f.store.putList({
      id: "list-kw",
      name: "All",
      kind: "static",
      projectIds: ["p1"],
      createdAt: NOW,
    });
    const sequence: Sequence = {
      id: "seq-1",
      name: "Follow up",
      listId: "list-kw",
      steps: [],
      status: "active",
      stopOnReply: true,
      pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
      createdAt: NOW,
    };
    await f.store.putRecord("sequence", "seq-1", sequence);
    await f.store.putRecord(
      "capture-rule",
      "r-seq",
      rule("r-seq", { targetListId: "list-kw", action: { kind: "enroll", sequenceId: "seq-1" } }),
    );
    await f.store.putSuppression({
      id: "sup-p",
      personId: personIdFor("acc-x", "u1"),
      channel: "all",
      reason: "opt_out",
      source: "test",
      at: NOW,
    });
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e1", "price")],
      [contact],
    );
    expect(await members(f.store, "list-kw")).toEqual([]);
    expect((await f.store.listEnrollments({ sequenceId: "seq-1" })).items).toEqual([]);
  });

  it("enrolls an unsuppressed person once, active and due now", async () => {
    const f = await fixture();
    await f.store.putRecord("sequence", "seq-1", {
      id: "seq-1",
      name: "Follow up",
      listId: "list-kw",
      steps: [],
      status: "active",
      stopOnReply: true,
      pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
      createdAt: NOW,
    } as Sequence);
    await f.store.putRecord(
      "capture-rule",
      "r-seq",
      rule("r-seq", { targetListId: "list-kw", action: { kind: "enroll", sequenceId: "seq-1" } }),
    );
    await f.store.putList({
      id: "list-kw",
      name: "All",
      kind: "static",
      projectIds: ["p1"],
      createdAt: NOW,
    });
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e1", "hi")],
      [contact],
    );
    await linkInboundToPeople(
      { store: f.store, now: NOW },
      account(),
      [comment("e2", "hi again")],
      [contact],
    );
    const page = await f.store.listEnrollments({ sequenceId: "seq-1" });
    expect(page.items.map((item) => [item.status, item.stepIndex, item.nextAt])).toEqual([
      ["active", 0, NOW],
    ]);
  });
});
