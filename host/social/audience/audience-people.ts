import type { SocialPerson } from "../../../src/features/social/model/audience";
import { array, exact, str } from "../core/social-helpers";
import type { SocialActionContext } from "../core/social-actions";
import { suppress } from "../autonomy/suppression";
import {
  accountIdsOf,
  chargeAutonomy,
  requireAutonomy,
  requirePerson,
  visiblePeople,
} from "./audience-access";
import { mergeEmailMatches } from "./audience-merge";
import {
  parseCommercialConsent,
  parseEmails,
  parseFilter,
  parseLimit,
  parseCursor,
  parseStage,
} from "./audience-validation";

const PATCH_FIELDS = ["name", "tags", "notes", "stage", "emails", "commercialConsent"];
const SCORE_LEVELS = [
  "low: no engagement or only passing engagement",
  "medium: repeated or specific engagement",
  "high: asks about the offer or engages again after a reply",
];
// Level order is ascending interest; index 0 is the lowest level.

/** Any suppression on the person or one of its identities, on any channel. */
async function hasSuppression(ctx: SocialActionContext, person: SocialPerson): Promise<boolean> {
  if ((await ctx.store.findSuppressions({ personId: person.id })).length) return true;
  for (const handle of person.handles) {
    const rows = await ctx.store.findSuppressions({
      platform: handle.platform,
      platformId: handle.platformId,
    });
    if (rows.length) return true;
  }
  return false;
}

/** people.list: keyset page. A dynamic list is evaluated by its own filter, a static list by membership. */
export async function listPeople(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["filter", "listId", "cursor", "limit"]);
  const listId = input.listId === undefined ? undefined : str(input.listId, "list", 300);
  const list = listId ? await ctx.store.getList(listId) : undefined;
  if (listId && !list) throw new Error("List not found.");
  const filter = input.filter === undefined ? undefined : parseFilter(input.filter);
  if (list?.kind === "dynamic" && filter)
    throw new Error("A dynamic list is already filtered. Remove the filter or use a static list.");
  const cursor = parseCursor(input.cursor);
  const page = await ctx.store.listPeople({
    ...(list?.kind === "dynamic" ? { filter: list.filter } : filter ? { filter } : {}),
    ...(list?.kind === "static" ? { listId: list.id } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    limit: parseLimit(input.limit, 200, 50),
  });
  return {
    items: await visiblePeople(ctx, page.items),
    ...(page.next ? { next: page.next } : {}),
  };
}

/** people.get: the person, last 100 interactions and whether any suppression applies. */
export async function getPerson(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["personId"]);
  const person = await requirePerson(ctx, str(input.personId, "person", 300));
  return {
    person,
    interactions: await ctx.store.listInteractions(person.id),
    suppressed: await hasSuppression(ctx, person),
  };
}

/** people.update: owner or autonomy "contacts" for every account the person is on. */
export async function updatePerson(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["personId", "patch"]);
  const person = await requirePerson(ctx, str(input.personId, "person", 300));
  if (!input.patch || typeof input.patch !== "object" || Array.isArray(input.patch))
    throw new Error("Invalid patch.");
  const patch = input.patch as Record<string, unknown>;
  exact(patch, PATCH_FIELDS);
  await requireAutonomy(ctx, accountIdsOf(person), "contacts");
  const next: SocialPerson = { ...person, updatedAt: ctx.now() };
  if (patch.name !== undefined) next.name = str(patch.name, "name", 300);
  if (patch.tags !== undefined) next.tags = array(patch.tags, "tags", 50);
  if (patch.notes !== undefined) {
    if (typeof patch.notes !== "string" || patch.notes.length > 5000)
      throw new Error("Invalid notes.");
    next.notes = patch.notes.trim();
  }
  if (patch.stage !== undefined) next.stage = parseStage(patch.stage);
  if (patch.emails !== undefined) next.emails = parseEmails(patch.emails);
  if (patch.commercialConsent !== undefined)
    next.commercialConsent = parseCommercialConsent(patch.commercialConsent);
  const saved = await ctx.store.putPerson(next);
  if (next.stage === "opted_out" && person.stage !== "opted_out")
    await suppress(
      { audience: ctx.store, now: ctx.now },
      { personId: saved.id, channel: "all", reason: "opt_out", source: "stage" },
    );
  // Automatic merge changes other people's records, so only the owner triggers it.
  if (patch.emails !== undefined && ctx.principal.kind === "owner")
    await mergeEmailMatches(ctx, [saved.id]);
  await chargeAutonomy(ctx, accountIdsOf(person), "contacts", 1);
  return (await ctx.store.getPerson(saved.id)) ?? saved;
}

/**
 * people.delete (owner only, DELETE_PERSON confirmation). A deleted person keeps a suppression
 * tombstone on every identity so it is never collected or contacted again. The person's
 * per-account contact records keep their threads; only the personal fields are overwritten.
 */
export async function deletePerson(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["personId", "confirm"]);
  if (input.confirm !== "DELETE_PERSON") throw new Error("Confirm with DELETE_PERSON.");
  const person = await ctx.store.getPerson(str(input.personId, "person", 300));
  if (!person) return { deleted: false, contacts: 0 };
  const deps = { audience: ctx.store, now: ctx.now };
  await suppress(deps, {
    personId: person.id,
    channel: "all",
    reason: "deleted",
    source: "delete",
  });
  for (const handle of person.handles)
    await suppress(deps, {
      personId: person.id,
      handle: { platform: handle.platform, platformId: handle.platformId },
      channel: "all",
      reason: "deleted",
      source: "delete",
    });
  await ctx.store.deletePerson(person.id);
  let contacts = 0;
  for (const handle of person.handles) {
    const contact = await ctx.service.contact(handle.contactId);
    if (!contact) continue;
    // Overwrites name and tags; opt-out cancels queued outreach to the contact.
    await ctx.service.upsertContact(ctx.principal, {
      accountId: contact.accountId,
      platformId: contact.platformId,
      name: "Deleted contact",
      tags: [],
      consent: { allowed: false, source: "deleted", at: ctx.now() },
    });
    contacts++;
  }
  return { deleted: true, contacts };
}

/** people.export (owner only): JSON of one person, one static list, or all people, 200 per page. */
export async function exportPeople(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["personId", "listId", "cursor"]);
  const exportedAt = ctx.now();
  if (input.personId !== undefined) {
    const person = await requirePerson(ctx, str(input.personId, "person", 300));
    const interactions = await ctx.store.listInteractions(person.id);
    return {
      json: JSON.stringify({ exportedAt, people: [{ ...person, interactions }] }, null, 2),
    };
  }
  const cursor = parseCursor(input.cursor);
  const limit = 200;
  if (input.listId !== undefined) {
    const listId = str(input.listId, "list", 300);
    const list = await ctx.store.getList(listId);
    if (!list) throw new Error("List not found.");
    if (list.kind === "static") {
      const members = await ctx.store.listMembers(listId, { cursor, limit });
      const people: SocialPerson[] = [];
      for (const id of members.personIds) {
        const person = await ctx.store.getPerson(id);
        if (person) people.push(person);
      }
      return {
        json: JSON.stringify({ exportedAt, people }, null, 2),
        ...(members.next ? { next: members.next } : {}),
      };
    }
  }
  const page = await ctx.store.listPeople({ cursor, limit });
  return {
    json: JSON.stringify({ exportedAt, people: page.items }, null, 2),
    ...(page.next ? { next: page.next } : {}),
  };
}

/**
 * people.score: AI interest level through the decision service. Without a configured decision
 * model no score is written.
 */
export async function scorePerson(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["personId"]);
  const person = await requirePerson(ctx, str(input.personId, "person", 300));
  if (!ctx.decisions) return { scored: false, person };
  await requireAutonomy(ctx, accountIdsOf(person), "contacts");
  const interactions = await ctx.store.listInteractions(person.id);
  const result = await ctx.decisions.decide({
    taskType: "interest_score",
    personalData: true,
    state: {
      stage: person.stage,
      tags: person.tags,
      interactions: interactions.slice(0, 20).map((item) => ({
        kind: item.kind,
        at: item.at,
        text: item.text?.slice(0, 280),
      })),
    },
    questions: {
      interest: {
        type: "score",
        instructions:
          "Rate how interested this person is in the account's offer, from public activity only.",
        criteria: SCORE_LEVELS,
      },
    },
  });
  const answer = result.answers.interest;
  if (!answer || "error" in answer) return { scored: false, person };
  // Assumption (unverified against a live model): a numeric value is the 0-based level index.
  const index = typeof answer.value === "number" ? answer.value : Number.NaN;
  if (!Number.isInteger(index) || index < 0 || index >= SCORE_LEVELS.length)
    return { scored: false, person };
  const now = ctx.now();
  const saved = await ctx.store.putPerson({
    ...person,
    score: {
      value: Math.round((index / (SCORE_LEVELS.length - 1)) * 100),
      reason: "AI interest score",
      at: now,
    },
    updatedAt: now,
  });
  await chargeAutonomy(ctx, accountIdsOf(person), "contacts", 1);
  return { scored: true, person: saved };
}
