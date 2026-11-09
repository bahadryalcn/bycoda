import { describe, expect, it } from "vitest";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import { contactOf, fixture, NOW, AI, OWNER, account } from "./audience-test-support";
import { addMembers, removeMembers, saveList } from "./audience-lists";
import { deletePerson, listPeople, updatePerson } from "./audience-people";
import { matchSuggestions } from "./audience-merge";

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
    projectIds: ["p1"],
    consent: { basis: "none" },
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe("people lists and segments", () => {
  it("evaluates a dynamic list by its own filter and a static list by membership", async () => {
    const f = await fixture();
    await f.store.putPerson(person("p-a", { tags: ["vip"] }));
    await f.store.putPerson(person("p-b"));
    await f.store.putPerson(person("p-c", { tags: ["vip", "lead"] }));
    await saveList(f.ctx(OWNER), {
      id: "vip",
      name: "VIP",
      kind: "dynamic",
      filter: { tags: ["vip"] },
    });
    await saveList(f.ctx(OWNER), { id: "team", name: "Team", kind: "static" });
    const dynamic = await listPeople(f.ctx(OWNER), { listId: "vip" });
    expect(dynamic.items.map((item) => item.id)).toEqual(["p-a", "p-c"]);
    await addMembers(f.ctx(OWNER), { listId: "team", personIds: ["p-b"] });
    const static_ = await listPeople(f.ctx(OWNER), { listId: "team" });
    expect(static_.items.map((item) => item.id)).toEqual(["p-b"]);
  });

  it("refuses a filter on a dynamic list and manual membership on a dynamic list", async () => {
    const f = await fixture();
    await f.store.putPerson(person("p-a", { tags: ["vip"] }));
    await saveList(f.ctx(OWNER), {
      id: "vip",
      name: "VIP",
      kind: "dynamic",
      filter: { tags: ["vip"] },
    });
    await expect(
      listPeople(f.ctx(OWNER), { listId: "vip", filter: { tags: ["x"] } }),
    ).rejects.toThrow("already filtered");
    await expect(addMembers(f.ctx(OWNER), { listId: "vip", personIds: ["p-a"] })).rejects.toThrow(
      "computed from their filter",
    );
  });

  it("skips suppressed and unknown people when adding members, and removes them again", async () => {
    const f = await fixture();
    await f.store.putPerson(person("p-a"));
    await f.store.putPerson(person("p-b"));
    await f.store.putSuppression({
      id: "sup-b",
      personId: "p-b",
      channel: "all",
      reason: "manual",
      source: "test",
      at: NOW,
    });
    await saveList(f.ctx(OWNER), { id: "team", name: "Team", kind: "static" });
    const added = await addMembers(f.ctx(OWNER), {
      listId: "team",
      personIds: ["p-a", "p-b", "missing"],
    });
    expect(added).toEqual({ added: 1, skipped: 2 });
    expect(await removeMembers(f.ctx(OWNER), { listId: "team", personIds: ["p-a"] })).toEqual({
      removed: 1,
    });
  });
});

describe("autonomy gate for non-owner writes", () => {
  const handle = {
    accountId: "acc-x",
    platform: "x" as const,
    platformId: "u1",
    contactId: "contact-acc-x-u1",
  };

  it("rejects a non-owner update at suggest level and accepts it at autonomous level", async () => {
    const f = await fixture({ levels: {} });
    await f.store.putPerson(person("p-a", { handles: [handle] }));
    await expect(
      updatePerson(f.ctx(AI), { personId: "p-a", patch: { tags: ["x"] } }),
    ).rejects.toThrow("Needs owner approval");
    expect((await f.store.getPerson("p-a"))?.tags).toEqual([]);

    f.levels["acc-x"] = "autonomous";
    const updated = await updatePerson(f.ctx(AI), { personId: "p-a", patch: { tags: ["x"] } });
    expect(updated.tags).toEqual(["x"]);
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(NOW);
    expect(await f.store.getCounter("acc-x", "contacts", day)).toBe(1);
  });

  it("does not show a non-owner people outside its project or without a readable account", async () => {
    const f = await fixture({ accounts: [account({ grants: {} })] });
    await f.store.putPerson(person("p-a", { handles: [handle] }));
    const visible = await listPeople(f.ctx(AI), {});
    expect(visible.items).toEqual([]);
  });
});

describe("delete, merge and matching", () => {
  it("requires the confirmation word and leaves a suppression tombstone and an erased contact", async () => {
    const f = await fixture();
    const contact = contactOf("acc-x", "u1", { name: "Ada" });
    f.contacts.set(contact.id, contact);
    await f.store.putPerson(
      person("p-a", {
        handles: [{ accountId: "acc-x", platform: "x", platformId: "u1", contactId: contact.id }],
      }),
    );
    await expect(deletePerson(f.ctx(OWNER), { personId: "p-a", confirm: "yes" })).rejects.toThrow(
      "DELETE_PERSON",
    );
    expect(await deletePerson(f.ctx(OWNER), { personId: "p-a", confirm: "DELETE_PERSON" })).toEqual(
      {
        deleted: true,
        contacts: 1,
      },
    );
    expect(await f.store.getPerson("p-a")).toBeUndefined();
    const tombstones = await f.store.findSuppressions({ platform: "x", platformId: "u1" });
    expect(tombstones.map((item) => item.reason)).toEqual(["deleted"]);
    expect(f.contacts.get(contact.id)?.name).toBe("Deleted contact");
  });

  it("merges people that share an exact e-mail on an owner update", async () => {
    const f = await fixture();
    await f.store.putPerson(
      person("p-1", {
        handles: [{ accountId: "acc-x", platform: "x", platformId: "u1", contactId: "c1" }],
        emails: [{ address: "ada@example.com", source: "import", verified: false }],
      }),
    );
    await f.store.putPerson(
      person("p-2", {
        handles: [{ accountId: "acc-x", platform: "x", platformId: "u2", contactId: "c2" }],
      }),
    );
    await updatePerson(f.ctx(OWNER), {
      personId: "p-2",
      patch: { emails: [{ address: "ADA@example.com", source: "manual" }] },
    });
    expect(await f.store.getPerson("p-1")).toBeUndefined();
    const target = await f.store.getPerson("p-2");
    expect(target?.handles.map((item) => item.platformId).sort()).toEqual(["u1", "u2"]);
  });

  it("suggests same-username pairs across platforms without merging them", async () => {
    const f = await fixture();
    await f.store.putPerson(
      person("p-3", {
        handles: [
          { accountId: "acc-x", platform: "x", platformId: "u3", contactId: "c3", username: "ada" },
        ],
      }),
    );
    await f.store.putPerson(
      person("p-4", {
        handles: [
          {
            accountId: "acc-ig",
            platform: "instagram",
            platformId: "i4",
            contactId: "c4",
            username: "Ada",
          },
        ],
      }),
    );
    const result = await matchSuggestions(f.ctx(OWNER), {});
    expect(
      result.suggestions.some(
        (item) => item.reason === "same_username" && item.personIds.join() === "p-3,p-4",
      ),
    ).toBe(true);
    expect(await f.store.getPerson("p-3")).toBeDefined();
    expect(await f.store.getPerson("p-4")).toBeDefined();
  });
});
