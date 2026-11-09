import { describe, expect, it } from "vitest";
import type { Suppression } from "../../../src/features/social/model/outreach";
import type { SocialAccount, SocialContact } from "../../../src/features/social/model/social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { assertSendable, isSuppressed, suppress, suppressContact, unsuppress } from "./suppression";

/** Fake of the store methods suppression uses: indexed suppressions and handle -> person links. */
function fakeStore(
  people: {
    id: string;
    accountId: string;
    platformId: string;
    handles: { platform: string; platformId: string }[];
  }[] = [],
) {
  const suppressions = new Map<string, Suppression>();
  const audience = {
    putSuppression: async (value: Suppression) => {
      suppressions.set(value.id, value);
      return value;
    },
    deleteSuppression: async (id: string) => suppressions.delete(id),
    findSuppressions: async (query: {
      personId?: string;
      platform?: string;
      platformId?: string;
      email?: string;
    }) => {
      if (!Object.keys(query).length)
        throw new Error("Suppression lookup needs a person, handle or email.");
      return [...suppressions.values()].filter(
        (row) =>
          (query.personId !== undefined && row.personId === query.personId) ||
          (query.platform !== undefined &&
            row.handle?.platform === query.platform &&
            row.handle?.platformId === query.platformId) ||
          (query.email !== undefined && row.email === query.email.toLowerCase()),
      );
    },
    findPersonByHandle: async (accountId: string, platformId: string) =>
      people.find((person) => person.accountId === accountId && person.platformId === platformId),
  } as unknown as SocialAudienceStore;
  return { audience, suppressions };
}

const accounts: Record<string, SocialAccount> = {
  "acc-a": { id: "acc-a", platform: "x" } as SocialAccount,
  "acc-b": { id: "acc-b", platform: "x" } as SocialAccount,
};
const contacts: Record<string, SocialContact> = {
  "contact-a": { id: "contact-a", accountId: "acc-a", platformId: "fan-1" } as SocialContact,
  "contact-b": { id: "contact-b", accountId: "acc-b", platformId: "fan-1" } as SocialContact,
};

function deps(audience: SocialAudienceStore) {
  return {
    audience,
    now: () => 100,
    get: async (kind: string, id: string) => (kind === "contact" ? contacts[id] : accounts[id]),
  } as never;
}

describe("assertSendable", () => {
  it("blocks a channel-all suppression on every channel", async () => {
    const { audience } = fakeStore();
    await suppress({ audience, now: () => 1 } as never, {
      handle: { platform: "x", platformId: "fan-1" },
      channel: "all",
      reason: "opt_out",
      source: "test",
    });
    await expect(assertSendable(deps(audience), { contactId: "contact-a" }, "dm")).rejects.toThrow(
      "suppressed",
    );
    await expect(
      assertSendable(deps(audience), { contactId: "contact-a" }, "comment"),
    ).rejects.toThrow("suppressed");
  });

  it("blocks another account's handle on the same platform after an opt-out elsewhere", async () => {
    const { audience } = fakeStore();
    await suppressContact(deps(audience), contacts["contact-a"], "opt-out");
    await expect(assertSendable(deps(audience), { contactId: "contact-b" }, "dm")).rejects.toThrow(
      "suppressed",
    );
  });

  it("applies a channel-specific suppression only to that channel", async () => {
    const { audience } = fakeStore();
    await suppress({ audience, now: () => 1 } as never, {
      personId: "person-1",
      channel: "dm",
      reason: "manual",
      source: "test",
    });
    const target = { platform: "x" as const, platformId: "nobody", personId: "person-1" };
    expect(await isSuppressed({ audience }, target, "dm")).toBe(true);
    expect(await isSuppressed({ audience }, target, "comment")).toBe(false);
  });

  it("matches a suppressed email case-insensitively", async () => {
    const { audience } = fakeStore();
    await suppress({ audience, now: () => 1 } as never, {
      email: "Ada@Example.com",
      channel: "email",
      reason: "complaint",
      source: "test",
    });
    expect(await isSuppressed({ audience }, { email: "ada@example.com" }, "email")).toBe(true);
  });

  it("resolves a contact's person and suppresses that person across handles", async () => {
    const people = [
      {
        id: "person-9",
        accountId: "acc-a",
        platformId: "fan-1",
        handles: [{ platform: "x", platformId: "fan-1" }],
      },
    ];
    const { audience } = fakeStore(people);
    await suppress({ audience, now: () => 1 } as never, {
      personId: "person-9",
      channel: "all",
      reason: "opt_out",
      source: "test",
    });
    await expect(assertSendable(deps(audience), { contactId: "contact-a" }, "dm")).rejects.toThrow(
      "suppressed",
    );
  });

  it("lets an unsuppressed target through", async () => {
    const { audience } = fakeStore();
    await expect(
      assertSendable(deps(audience), { contactId: "contact-b" }, "dm"),
    ).resolves.toBeUndefined();
  });
});

describe("suppress and unsuppress", () => {
  it("is idempotent for the same person, handle, email and channel", async () => {
    const { audience, suppressions } = fakeStore();
    const first = await suppress({ audience, now: () => 1 } as never, {
      personId: "p",
      channel: "all",
      reason: "opt_out",
      source: "a",
    });
    const second = await suppress({ audience, now: () => 2 } as never, {
      personId: "p",
      channel: "all",
      reason: "opt_out",
      source: "b",
    });
    expect(second.id).toBe(first.id);
    expect(suppressions.size).toBe(1);
  });

  it("removes one record by id", async () => {
    const { audience, suppressions } = fakeStore();
    const row = await suppress({ audience, now: () => 1 } as never, {
      personId: "p",
      channel: "all",
      reason: "manual",
      source: "a",
    });
    expect(await unsuppress({ audience }, row.id)).toBe(true);
    expect(suppressions.size).toBe(0);
  });

  it("refuses a suppression with no person, handle or email", async () => {
    const { audience } = fakeStore();
    await expect(
      suppress({ audience, now: () => 1 } as never, {
        channel: "all",
        reason: "manual",
        source: "a",
      }),
    ).rejects.toThrow("needs a person");
  });
});
