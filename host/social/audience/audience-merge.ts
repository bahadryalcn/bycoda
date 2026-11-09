import type { SocialPerson } from "../../../src/features/social/model/audience";
import { array, exact, str } from "../core/social-helpers";
import type { SocialActionContext } from "../core/social-actions";
import {
  accountIdsOf,
  chargeAutonomy,
  requireAutonomy,
  requirePerson,
  visiblePeople,
} from "./audience-access";

/** Pages through the store at most this far per call. shortcut: a linear scan; upgrade with indexed email and username columns. */
const SCAN_LIMIT = 5000;
/** Groups larger than this are not paired (quadratic work and noisy suggestions). */
const MAX_GROUP = 20;
const MAX_SUGGESTIONS = 100;

export async function scanPeople(ctx: SocialActionContext): Promise<SocialPerson[]> {
  const people: SocialPerson[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.store.listPeople({ cursor, limit: 200 });
    people.push(...page.items);
    cursor = page.next;
  } while (cursor && people.length < SCAN_LIMIT);
  return people;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(keyOf(item))) seen.set(keyOf(item), item);
  return [...seen.values()];
}

/** True when any listed static list holds one of the given people. */
async function listsHoldAny(
  ctx: SocialActionContext,
  listId: string,
  personIds: Set<string>,
): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await ctx.store.listMembers(listId, { cursor });
    if (page.personIds.some((id) => personIds.has(id))) return true;
    cursor = page.next;
  } while (cursor);
  return false;
}

/**
 * Folds the sources into the target: the target keeps its own id and gains the sources' handles,
 * emails, tags, memberships, interactions (newest 100 per source) and suppressions. Additive
 * copies run first, so an interrupted merge leaves the source records in place.
 * Enrollments of the sources are removed with them (not carried over).
 */
export async function mergeInto(
  ctx: SocialActionContext,
  targetId: string,
  sourceIds: string[],
): Promise<SocialPerson> {
  const store = ctx.store;
  const now = ctx.now();
  const target = await store.getPerson(targetId);
  if (!target) throw new Error("Person not found.");
  const sources: SocialPerson[] = [];
  for (const id of new Set(sourceIds)) {
    if (id === targetId) continue;
    const source = await store.getPerson(id);
    if (!source) throw new Error("Person not found.");
    sources.push(source);
  }
  if (!sources.length) return target;
  const sourceSet = new Set(sources.map((source) => source.id));
  for (const list of (await store.listLists()).filter((item) => item.kind === "static"))
    if (await listsHoldAny(ctx, list.id, sourceSet))
      await store.addMembers(list.id, [targetId], { source: "merge", at: now });
  for (const source of sources) {
    for (const interaction of await store.listInteractions(source.id))
      await store.addInteraction({
        ...interaction,
        id: `${interaction.id}~${targetId}`,
        personId: targetId,
      });
    for (const suppression of await store.findSuppressions({ personId: source.id }))
      await store.putSuppression({
        ...suppression,
        id: `${suppression.id}~${targetId}`,
        personId: targetId,
      });
  }
  // Sources go before the target takes their handles: a handle row may belong to one person only.
  for (const source of sources) await store.deletePerson(source.id);
  const everyone = [target, ...sources];
  const language = target.language ?? sources.find((source) => source.language)?.language;
  return await store.putPerson({
    ...target,
    handles: dedupeBy(
      everyone.flatMap((person) => person.handles),
      (handle) => `${handle.accountId}\u0000${handle.platformId}`,
    ),
    emails: dedupeBy(
      everyone.flatMap((person) => person.emails),
      (email) => email.address,
    ),
    tags: [...new Set(everyone.flatMap((person) => person.tags))],
    projectIds: [...new Set(everyone.flatMap((person) => person.projectIds))],
    notes: everyone
      .map((person) => person.notes)
      .filter(Boolean)
      .join("\n"),
    ...(language ? { language } : {}),
    updatedAt: now,
  });
}

/**
 * Automatic merge on an exact e-mail match (owner decision D6=B). Each listed person absorbs the
 * other people who share one of its addresses. Callers must be the owner: this scans all people.
 */
export async function mergeEmailMatches(
  ctx: SocialActionContext,
  personIds: string[],
): Promise<void> {
  const people = await scanPeople(ctx);
  const byId = new Map(people.map((person) => [person.id, person]));
  const byEmail = new Map<string, SocialPerson[]>();
  for (const person of people)
    for (const email of person.emails) push(byEmail, email.address, person);
  const merged = new Set<string>();
  for (const id of new Set(personIds)) {
    if (merged.has(id)) continue;
    const person = byId.get(id);
    if (!person) continue;
    const sourceIds = new Set<string>();
    for (const email of person.emails)
      for (const other of byEmail.get(email.address) ?? [])
        if (other.id !== id && !merged.has(other.id)) sourceIds.add(other.id);
    if (!sourceIds.size) continue;
    await mergeInto(ctx, id, [...sourceIds]);
    for (const sourceId of sourceIds) merged.add(sourceId);
  }
}

/** people.merge: owner or autonomy "contacts" on every account involved. */
export async function mergePeople(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["targetId", "sourceIds"]);
  const targetId = str(input.targetId, "person", 300);
  const sourceIds = array(input.sourceIds, "sources", 20);
  const target = await requirePerson(ctx, targetId);
  const accounts = [...accountIdsOf(target)];
  for (const id of sourceIds) accounts.push(...accountIdsOf(await requirePerson(ctx, id)));
  await requireAutonomy(ctx, accounts, "contacts");
  const merged = await mergeInto(ctx, targetId, sourceIds);
  await chargeAutonomy(ctx, accounts, "contacts", 1);
  return merged;
}

type Suggestion = { personIds: string[]; reason: string; score: number };

/**
 * people.matchSuggestions: people that probably are one person. Pairs share an e-mail (score 1),
 * a profile URL (0.9) or a username on two different platforms (0.6). Suggestions only; nothing merges.
 */
export async function matchSuggestions(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["personId"]);
  const focus =
    input.personId === undefined
      ? undefined
      : (await requirePerson(ctx, str(input.personId, "person", 300))).id;
  const people = await visiblePeople(ctx, await scanPeople(ctx));
  const byEmail = new Map<string, string[]>();
  const byProfile = new Map<string, string[]>();
  const byUsername = new Map<string, { id: string; platform: string }[]>();
  for (const person of people) {
    for (const email of person.emails) push(byEmail, email.address, person.id);
    for (const handle of person.handles) {
      if (handle.profileUrl) push(byProfile, handle.profileUrl.toLowerCase(), person.id);
      if (handle.username)
        push(byUsername, handle.username.toLowerCase(), {
          id: person.id,
          platform: handle.platform,
        });
    }
  }
  const found = new Map<string, Suggestion>();
  const consider = (ids: string[], reason: string, score: number) => {
    const group = [...new Set(ids)];
    if (group.length < 2 || group.length > MAX_GROUP) return;
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const pair = [group[i], group[j]].sort();
        if (focus && !pair.includes(focus)) continue;
        const key = `${reason}:${pair.join("|")}`;
        if (!found.has(key)) found.set(key, { personIds: pair, reason, score });
      }
  };
  for (const ids of byEmail.values()) consider(ids, "same_email", 1);
  for (const ids of byProfile.values()) consider(ids, "same_profile", 0.9);
  for (const entries of byUsername.values()) {
    if (new Set(entries.map((entry) => entry.platform)).size < 2) continue;
    consider(
      entries.map((entry) => entry.id),
      "same_username",
      0.6,
    );
  }
  const suggestions = [...found.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);
  return { suggestions };
}
