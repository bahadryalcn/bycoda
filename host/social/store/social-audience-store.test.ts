import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import {
  AUDIENCE_SCHEMA_KEY,
  PERSON_EMAIL_INDEX_KEY,
  SYSTEM_COMMENTERS_LIST_ID,
  SYSTEM_COMMENTERS_RULE_ID,
  SocialAudienceStore,
  migrateAudience,
} from "./social-audience-store";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { SequenceEnrollment, Suppression } from "../../../src/features/social/model/outreach";
import type { AiAction } from "../../../src/features/social/model/autonomy";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-audience-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const audience = new SocialAudienceStore(store);
  await audience.initialize();
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, audience };
}

function person(id: string, patch: Partial<SocialPerson> = {}): SocialPerson {
  return {
    id,
    name: id,
    handles: [],
    emails: [],
    tags: [],
    notes: "",
    stage: "new",
    source: "manual",
    projectIds: [],
    consent: { basis: "none" },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

async function seedLegacy(store: HostStore) {
  const insert = store.db.prepare("INSERT INTO social_records VALUES (?,?,?)");
  const rows: [string, string, unknown][] = [
    ["account", "account-x", { id: "account-x", platform: "x" }],
    ["account", "account-tg", { id: "account-tg", platform: "telegram" }],
    [
      "contact",
      "c1",
      {
        id: "c1",
        accountId: "account-x",
        platformId: "u1",
        name: "Ada",
        profileUrl: "https://x.com/u1",
        tags: ["vip", "beta"],
        language: "tr",
        projectIds: ["p1"],
        consent: { allowed: true, source: "dm", at: 5 },
        replyEligible: true,
        commentEligible: true,
        optedOut: false,
        history: [],
      },
    ],
    [
      "contact",
      "c2",
      {
        id: "c2",
        accountId: "account-x",
        platformId: "u2",
        name: "Bo",
        tags: [],
        projectIds: ["p1"],
        replyEligible: false,
        commentEligible: false,
        optedOut: true,
        history: [],
      },
    ],
    [
      "contact",
      "c3",
      {
        id: "c3",
        accountId: "account-tg",
        platformId: "t1",
        name: "Cem",
        tags: ["beta"],
        projectIds: ["p1"],
        consent: { allowed: false, source: "import", at: 6 },
        replyEligible: false,
        commentEligible: false,
        optedOut: false,
        history: [],
      },
    ],
    [
      "contact",
      "c4",
      {
        id: "c4",
        accountId: "deleted-account",
        platformId: "z9",
        name: "Orphan",
        tags: [],
        projectIds: [],
        replyEligible: false,
        commentEligible: false,
        optedOut: false,
        history: [],
      },
    ],
    [
      "segment",
      "seg-beta",
      { id: "seg-beta", name: "Beta", projectIds: ["p1"], tags: ["beta"], language: "tr" },
    ],
  ];
  for (const [kind, id, value] of rows) await insert.run(kind, id, JSON.stringify(value));
}

describe("audience migration", () => {
  it("converts contacts, opt-outs and segments without deleting legacy records", async () => {
    const { store, audience } = await fixture();
    await seedLegacy(store);

    const first = await migrateAudience(audience, undefined, 1000);
    expect(first).toEqual({ migrated: true, people: 4, lists: 1, suppressions: 1 });

    const ada = await audience.getPerson("person-c1");
    expect(ada).toMatchObject({
      name: "Ada",
      language: "tr",
      stage: "new",
      source: "migration",
      tags: ["vip", "beta"],
      consent: { basis: "explicit" },
      handles: [
        {
          accountId: "account-x",
          platform: "x",
          platformId: "u1",
          contactId: "c1",
          profileUrl: "https://x.com/u1",
        },
      ],
    });
    expect((await audience.getPerson("person-c3"))?.consent).toEqual({ basis: "none" });
    expect((await audience.getPerson("person-c4"))?.handles).toEqual([]);
    expect(await audience.findPersonByHandle("account-tg", "t1")).toMatchObject({
      id: "person-c3",
    });

    const bo = await audience.getPerson("person-c2");
    expect(bo?.stage).toBe("opted_out");
    const suppressions = await audience.findSuppressions({ personId: "person-c2" });
    expect(suppressions).toEqual([
      expect.objectContaining({
        channel: "all",
        reason: "opt_out",
        handle: { platform: "x", platformId: "u2" },
      }),
    ]);

    expect(await audience.getList("seg-beta")).toEqual({
      id: "seg-beta",
      name: "Beta",
      kind: "dynamic",
      filter: { tags: ["beta"], language: "tr" },
      projectIds: ["p1"],
      createdAt: 1000,
    });
    expect(await audience.getList(SYSTEM_COMMENTERS_LIST_ID)).toMatchObject({
      kind: "static",
      system: "commenters",
    });
    expect(await audience.getRecord("capture-rule", SYSTEM_COMMENTERS_RULE_ID)).toMatchObject({
      enabled: false,
      source: { kind: "own_post_comments", accountId: "" },
      targetListId: SYSTEM_COMMENTERS_LIST_ID,
    });
    expect(await audience.getSetting(AUDIENCE_SCHEMA_KEY)).toBe("1");

    expect(await audience.legacyRecords("contact")).toHaveLength(4);
    expect(await audience.legacyRecords("segment")).toHaveLength(1);
  });

  it("is a no-op on the second run", async () => {
    const { store, audience } = await fixture();
    await seedLegacy(store);
    await migrateAudience(audience, undefined, 1000);
    const people = await audience.listPeople({ limit: 200 });

    const second = await migrateAudience(audience, undefined, 2000);
    expect(second).toEqual({ migrated: false, people: 0, lists: 0, suppressions: 0 });
    expect((await audience.listPeople({ limit: 200 })).items).toEqual(people.items);
    expect(await audience.listLists()).toHaveLength(2);
    expect(await audience.findSuppressions({ personId: "person-c2" })).toHaveLength(1);
  });
});

describe("e-mail index and membership lookups", () => {
  const email = (address: string) => ({ address, source: "manual" as const, verified: false });

  it("finds people by exact address and follows edits and deletes", async () => {
    const { audience } = await fixture();
    await audience.putPerson(person("p-1", { emails: [email("a@x.com"), email("a@x.com")] }));
    await audience.putPerson(person("p-2", { emails: [email("a@x.com"), email("b@x.com")] }));
    await audience.putPerson(person("p-3", { emails: [email("c@x.com")] }));
    expect(await audience.findPersonIdsByEmail(["a@x.com"])).toEqual(["p-1", "p-2"]);
    expect(await audience.findPersonIdsByEmail(["b@x.com", "c@x.com"])).toEqual(["p-2", "p-3"]);
    expect(await audience.findPersonIdsByEmail(["A@x.com"])).toEqual([]);
    await audience.putPerson(person("p-1", { emails: [email("z@x.com")] }));
    expect(await audience.findPersonIdsByEmail(["a@x.com"])).toEqual(["p-2"]);
    await audience.deletePerson("p-2");
    expect(await audience.findPersonIdsByEmail(["a@x.com", "b@x.com"])).toEqual([]);
  });

  it("rebuilds the index for people stored before it existed", async () => {
    const { store, audience } = await fixture();
    await audience.putPerson(person("p-1", { emails: [email("a@x.com")] }));
    await store.db.prepare("DELETE FROM social_person_emails").run();
    await store.db.prepare("DELETE FROM social_settings WHERE key=?").run(PERSON_EMAIL_INDEX_KEY);
    expect(await audience.findPersonIdsByEmail(["a@x.com"])).toEqual([]);
    await audience.initialize();
    expect(await audience.findPersonIdsByEmail(["a@x.com"])).toEqual(["p-1"]);
    expect(await audience.getSetting(PERSON_EMAIL_INDEX_KEY)).toBe("1");
  });

  it("lists only static lists that hold any of the people", async () => {
    const { store, audience } = await fixture();
    const list = (id: string, kind: "static" | "dynamic") =>
      audience.putList({ id, name: id, kind, projectIds: [], createdAt: 1 });
    await list("s-1", "static");
    await list("s-2", "static");
    await list("s-3", "static");
    await list("d-1", "dynamic");
    await audience.addMembers("s-1", ["p-1"], { source: "test", at: 1 });
    await audience.addMembers("s-2", ["p-1", "p-2"], { source: "test", at: 1 });
    await audience.addMembers("s-3", ["p-9"], { source: "test", at: 1 });
    await store.db
      .prepare("INSERT INTO social_list_members VALUES (?,?,?,?)")
      .run("d-1", "p-1", 1, "test");
    expect(await audience.staticListIdsHolding(["p-1", "p-2"])).toEqual(["s-1", "s-2"]);
    expect(await audience.staticListIdsHolding([])).toEqual([]);
  });
});

describe("people paging and filters", () => {
  it("pages at most 200 people per call and never returns more", async () => {
    const { audience } = await fixture();
    for (let index = 0; index < 205; index++)
      await audience.putPerson(person(`p-${String(index).padStart(3, "0")}`));

    const first = await audience.listPeople({ limit: 1000 });
    expect(first.items).toHaveLength(200);
    expect(first.next).toBe("p-199");

    const second = await audience.listPeople({ cursor: first.next, limit: 200 });
    expect(second.items).toHaveLength(5);
    expect(second.next).toBeUndefined();
  });

  it("applies tag (all), stage and platform filters in SQL", async () => {
    const { audience } = await fixture();
    await audience.putPerson(
      person("a", {
        tags: ["vip", "beta"],
        stage: "interested",
        handles: [{ accountId: "x1", platform: "x", platformId: "a", contactId: "ca" }],
      }),
    );
    await audience.putPerson(person("b", { tags: ["vip"], stage: "interested" }));
    await audience.putPerson(
      person("c", {
        tags: ["vip", "beta"],
        stage: "new",
        handles: [{ accountId: "tg1", platform: "telegram", platformId: "c", contactId: "cc" }],
      }),
    );

    const both = await audience.listPeople({ filter: { tags: ["vip", "beta"] } });
    expect(both.items.map((item) => item.id)).toEqual(["a", "c"]);

    const interested = await audience.listPeople({
      filter: { tags: ["vip"], stages: ["interested"] },
    });
    expect(interested.items.map((item) => item.id)).toEqual(["a", "b"]);

    const onX = await audience.listPeople({ filter: { platforms: ["x"] } });
    expect(onX.items.map((item) => item.id)).toEqual(["a"]);
  });

  it("reads list members through the membership table", async () => {
    const { audience } = await fixture();
    await audience.putPerson(person("a"));
    await audience.putPerson(person("b"));
    await audience.putList({
      id: "list-1",
      name: "List",
      kind: "static",
      projectIds: [],
      createdAt: 1,
    });
    expect(await audience.addMembers("list-1", ["a", "b"], { source: "test", at: 2 })).toBe(2);
    expect(await audience.addMembers("list-1", ["a"], { source: "test", at: 3 })).toBe(0);

    const members = await audience.listPeople({ listId: "list-1" });
    expect(members.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(await audience.listMembers("list-1", { limit: 1 })).toEqual({
      personIds: ["a"],
      next: "a",
    });
    expect(await audience.removeMembers("list-1", ["a"])).toBe(1);
    expect((await audience.listPeople({ listId: "list-1" })).items.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("handles and person lifecycle", () => {
  it("finds a person by platform handle and refuses to share a handle", async () => {
    const { audience } = await fixture();
    const handle = { accountId: "x1", platform: "x" as const, platformId: "same", contactId: "c" };
    await audience.putPerson(person("first", { handles: [handle] }));
    expect((await audience.findPersonByHandle("x1", "same"))?.id).toBe("first");
    await expect(audience.putPerson(person("second", { handles: [handle] }))).rejects.toThrow(
      "already belongs to another person",
    );
    expect(await audience.findPersonByHandle("x1", "missing")).toBeUndefined();
  });

  it("links a handle to an existing person once", async () => {
    const { audience } = await fixture();
    await audience.putPerson(person("p"));
    const handle = { accountId: "x1", platform: "x" as const, platformId: "u", contactId: "c" };
    await audience.linkHandle("p", handle, 5);
    const linked = await audience.linkHandle("p", handle, 6);
    expect(linked.handles).toHaveLength(1);
    expect((await audience.findPersonByHandle("x1", "u"))?.id).toBe("p");
  });

  it("deletes a person with dependent rows and keeps the suppression tombstone", async () => {
    const { audience } = await fixture();
    await audience.putPerson(
      person("gone", {
        handles: [{ accountId: "x1", platform: "x", platformId: "gone", contactId: "c" }],
      }),
    );
    await audience.addInteraction({
      id: "i1",
      personId: "gone",
      accountId: "x1",
      platform: "x",
      kind: "comment",
      at: 1,
      direction: "inbound",
    });
    await audience.putSuppression({
      id: "tomb",
      personId: "gone",
      channel: "all",
      reason: "deleted",
      source: "owner",
      at: 2,
    });
    expect(await audience.deletePerson("gone")).toBe(true);
    expect(await audience.getPerson("gone")).toBeUndefined();
    expect(await audience.findPersonByHandle("x1", "gone")).toBeUndefined();
    expect(await audience.listInteractions("gone")).toEqual([]);
    expect(await audience.findSuppressions({ personId: "gone" })).toHaveLength(1);
  });
});

describe("interactions, enrollments and suppressions", () => {
  it("lists the newest interactions first and ignores duplicate ids", async () => {
    const { audience } = await fixture();
    const base = {
      personId: "p",
      accountId: "x1",
      platform: "x" as const,
      direction: "inbound" as const,
    };
    expect(await audience.addInteraction({ ...base, id: "old", kind: "comment", at: 1 })).toBe(
      true,
    );
    expect(await audience.addInteraction({ ...base, id: "new", kind: "mention", at: 9 })).toBe(
      true,
    );
    expect(await audience.addInteraction({ ...base, id: "old", kind: "comment", at: 1 })).toBe(
      false,
    );
    expect((await audience.listInteractions("p")).map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("returns only active enrollments that are due", async () => {
    const { audience } = await fixture();
    const enrollment = (id: string, patch: Partial<SequenceEnrollment>): SequenceEnrollment => ({
      id,
      sequenceId: "seq",
      personId: id,
      stepIndex: 0,
      status: "active",
      updatedAt: 1,
      ...patch,
    });
    await audience.putEnrollment(enrollment("due", { nextAt: 100 }));
    await audience.putEnrollment(enrollment("later", { nextAt: 500 }));
    await audience.putEnrollment(enrollment("paused", { nextAt: 100, status: "stopped" }));
    expect((await audience.dueEnrollments(200)).map((item) => item.id)).toEqual(["due"]);
    const page = await audience.listEnrollments({ sequenceId: "seq", limit: 2 });
    expect(page.items.map((item) => item.id)).toEqual(["due", "later"]);
  });

  it("matches suppressions by handle only with both platform fields and by email case-insensitively", async () => {
    const { audience } = await fixture();
    const base: Suppression = {
      id: "s1",
      handle: { platform: "telegram", platformId: "t1" },
      email: "Ada@Example.com",
      channel: "all",
      reason: "bounce",
      source: "test",
      at: 1,
    };
    await audience.putSuppression(base);
    expect(
      await audience.findSuppressions({ platform: "telegram", platformId: "t1" }),
    ).toHaveLength(1);
    expect(await audience.findSuppressions({ email: "ada@example.com" })).toHaveLength(1);
    await expect(audience.findSuppressions({ platform: "telegram" })).rejects.toThrow(
      "needs both platform and platformId",
    );
    await expect(audience.findSuppressions({})).rejects.toThrow("needs a person, handle or email");
    expect(await audience.deleteSuppression("s1")).toBe(true);
    expect(await audience.findSuppressions({ email: "ada@example.com" })).toEqual([]);
  });

  it("counts daily actions per account and day", async () => {
    const { audience } = await fixture();
    expect(await audience.getCounter("x1", "reply", "2026-11-07")).toBe(0);
    expect(await audience.incrementCounter("x1", "reply", "2026-11-07")).toBe(1);
    expect(await audience.incrementCounter("x1", "reply", "2026-11-07", 2)).toBe(3);
    expect(await audience.getCounter("x1", "reply", "2026-11-08")).toBe(0);
  });

  it("pages the AI action log newest first with a stable cursor", async () => {
    const { audience } = await fixture();
    const action = (id: string, at: number): AiAction => ({
      id,
      at,
      actor: "owner",
      accountId: "x1",
      action: "replies.send",
      summary: id,
      status: "done",
    });
    await audience.putAiAction(action("a", 1));
    await audience.putAiAction(action("b", 2));
    await audience.putAiAction(action("c", 2));
    const first = await audience.listAiActions({ limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(["c", "b"]);
    const second = await audience.listAiActions({ cursor: first.next, limit: 2 });
    expect(second.items.map((item) => item.id)).toEqual(["a"]);
    expect(second.next).toBeUndefined();
    await expect(audience.listAiActions({ cursor: "bad" })).rejects.toThrow(
      "Invalid AI action cursor",
    );
  });
});

describe("enrollments by person and store transactions", () => {
  it("lists every enrollment of one person and rolls back a failed transaction", async () => {
    const { audience } = await fixture();
    const base = { stepIndex: 0, status: "active" as const, updatedAt: 1 };
    await audience.putEnrollment({ ...base, id: "e1", sequenceId: "seq-a", personId: "p1" });
    await audience.putEnrollment({ ...base, id: "e2", sequenceId: "seq-b", personId: "p1" });
    await audience.putEnrollment({ ...base, id: "e3", sequenceId: "seq-a", personId: "p2" });
    expect((await audience.listEnrollmentsForPerson("p1")).map((item) => item.id)).toEqual([
      "e1",
      "e2",
    ]);
    await expect(
      audience.transaction(async () => {
        await audience.putSetting("tx-probe", "written");
        throw new Error("stop the transaction");
      }),
    ).rejects.toThrow("stop the transaction");
    expect(await audience.getSetting("tx-probe")).toBeUndefined();
  });
});

describe("reply stats and AI action window", () => {
  it("counts contacted and replied people in one aggregate over the full history", async () => {
    const { audience } = await fixture();
    const add = (personId: string, direction: "inbound" | "outbound", at: number, id: string) =>
      audience.addInteraction({
        id,
        personId,
        accountId: "x1",
        platform: "x",
        kind: "comment",
        at,
        direction,
      });
    // p1: outbound at 150, reply at 200.
    await add("p1", "outbound", 150, "p1-out");
    await add("p1", "inbound", 200, "p1-in");
    // p2: outbound with no reply.
    await add("p2", "outbound", 160, "p2-out");
    // p3: outbound only before the window, so not contacted.
    await add("p3", "outbound", 50, "p3-out");
    // p4: inbound only, so not contacted.
    await add("p4", "inbound", 300, "p4-in");
    // p5: inbound before the first outbound does not count as a reply.
    await add("p5", "inbound", 130, "p5-in");
    await add("p5", "outbound", 160, "p5-out");
    // p6: the reply is older than 100 newer rows, so only a full-history read finds it.
    await add("p6", "outbound", 150, "p6-out");
    await add("p6", "inbound", 200, "p6-in");
    for (let index = 0; index < 100; index++) {
      await add("p6", "outbound", 1_000 + index, `p6-noise-${index}`);
    }
    expect(await audience.replyStats(["p1", "p2", "p3", "p4", "p5", "p6"], 100)).toEqual({
      contacted: 4,
      replied: 2,
    });
    expect(await audience.replyStats([], 100)).toEqual({ contacted: 0, replied: 0 });
  });

  it("reads one thread or contact by id and only the threads of the given handles", async () => {
    const { store, audience } = await fixture();
    const insert = store.db.prepare("INSERT INTO social_records VALUES (?,?,?)");
    const rows: [string, string, unknown][] = [
      ["contact", "c-ana", { id: "c-ana", accountId: "x1", platformId: "ana", name: "Ana" }],
      ["contact", "c-bo", { id: "c-bo", accountId: "x1", platformId: "bo", name: "Bo" }],
      ["contact", "c-ana-y", { id: "c-ana-y", accountId: "y1", platformId: "ana", name: "Ana" }],
      ["thread", "t-ana", { id: "t-ana", accountId: "x1", contactId: "c-ana", events: [] }],
      ["thread", "t-bo", { id: "t-bo", accountId: "x1", contactId: "c-bo", events: [] }],
      ["thread", "t-ana-y", { id: "t-ana-y", accountId: "y1", contactId: "c-ana-y", events: [] }],
    ];
    for (const [kind, id, value] of rows) await insert.run(kind, id, JSON.stringify(value));
    expect(await audience.getThread("t-bo")).toMatchObject({ id: "t-bo" });
    expect(await audience.getThread("c-bo")).toBeUndefined();
    expect(await audience.getContact("c-bo")).toMatchObject({ platformId: "bo" });
    const found = await audience.threadsForHandles("x1", ["ana"]);
    expect(found.map((item) => item.thread.id)).toEqual(["t-ana"]);
    expect(found[0].contact.id).toBe("c-ana");
    expect(await audience.threadsForHandles("x1", [])).toEqual([]);
  });

  it("filters the AI action log by since before paging, newest first", async () => {
    const { audience } = await fixture();
    const action = (id: string, at: number): AiAction => ({
      id,
      at,
      actor: "owner",
      accountId: "x1",
      action: "replies.send",
      summary: id,
      status: "done",
    });
    await audience.putAiAction(action("a", 1));
    await audience.putAiAction(action("b", 2));
    await audience.putAiAction(action("c", 3));
    const first = await audience.listAiActions({ since: 2, limit: 1 });
    expect(first.items.map((item) => item.id)).toEqual(["c"]);
    const second = await audience.listAiActions({ since: 2, cursor: first.next, limit: 1 });
    expect(second.items.map((item) => item.id)).toEqual(["b"]);
    expect(second.next).toBeUndefined();
  });
});
