import { randomUUID } from "node:crypto";
import type { SocialList } from "../../../src/features/social/model/audience";
import { array, exact, str } from "../core/social-helpers";
import type { SocialActionContext } from "../core/social-actions";
import {
  assertListVisible,
  canSeePerson,
  chargeAutonomy,
  readableAccountIds,
  requireAutonomy,
} from "./audience-access";
import { identityBlocked } from "./audience-person";
import { isEmptyFilter, parseFilter } from "./audience-validation";

const MAX_BATCH = 500;

/** A list the action may touch: it exists, is visible to the principal, and is not a system list when changed. */
async function existingList(ctx: SocialActionContext, id: string): Promise<SocialList> {
  const list = await ctx.store.getList(id);
  if (!list) throw new Error("List not found.");
  assertListVisible(ctx, list);
  return list;
}

/** lists.list: lists of the principal's project. System lists are listed for owners only. */
export async function listLists(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, []);
  const lists = await ctx.store.listLists();
  return {
    items:
      ctx.principal.kind === "owner"
        ? lists
        : lists.filter(
            (list) =>
              !!ctx.principal.projectId && list.projectIds.includes(ctx.principal.projectId),
          ),
  };
}

/** lists.save: create or replace a static or dynamic list. Non-owners need autonomy "audience". */
export async function saveList(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id", "name", "kind", "filter", "projectIds"]);
  const id = input.id === undefined ? randomUUID() : str(input.id, "list", 300);
  const previous = await ctx.store.getList(id);
  if (previous) {
    if (previous.system) throw new Error("System lists cannot be changed.");
    assertListVisible(ctx, previous);
  }
  const kind =
    input.kind === "dynamic" ? "dynamic" : input.kind === "static" ? "static" : undefined;
  if (!kind) throw new Error("Invalid list kind.");
  if (kind === "static" && input.filter !== undefined)
    throw new Error("A static list has no filter. Members are added by hand or by rules.");
  const filter = kind === "dynamic" ? parseFilter(input.filter) : undefined;
  if (kind === "dynamic" && isEmptyFilter(filter))
    throw new Error("A dynamic list needs at least one filter rule.");
  const projectIds =
    input.projectIds !== undefined
      ? array(input.projectIds, "projects", 20)
      : (previous?.projectIds ?? (ctx.principal.projectId ? [ctx.principal.projectId] : []));
  if (ctx.principal.kind !== "owner" && projectIds.some((item) => item !== ctx.principal.projectId))
    throw new Error("Private audience data belongs to another project.");
  await requireAutonomy(ctx, await readableAccountIds(ctx), "audience");
  const list: SocialList = {
    id,
    name: str(input.name, "list name", 120),
    kind,
    ...(filter ? { filter } : {}),
    projectIds,
    createdAt: previous?.createdAt ?? ctx.now(),
  };
  const saved = await ctx.store.putList(list);
  await chargeAutonomy(ctx, await readableAccountIds(ctx), "audience", 1);
  return saved;
}

/**
 * Work that still points at a list: capture rules that fill it and sequences that have not
 * finished. Deleting the list would leave them pointing at nothing, so the delete is refused.
 */
async function listInUse(ctx: SocialActionContext, listId: string): Promise<string | undefined> {
  let cursor: string | undefined;
  do {
    const page = await ctx.store.listRecords("capture-rule", { cursor, limit: 200 });
    const rule = page.items.find((item) => item.targetListId === listId);
    if (rule) return `The capture rule "${rule.name}" adds people to this list.`;
    cursor = page.next;
  } while (cursor);
  do {
    const page = await ctx.store.listRecords("sequence", { cursor, limit: 200 });
    const sequence = page.items.find((item) => item.listId === listId && item.status !== "done");
    if (sequence) return `The sequence "${sequence.name}" sends to this list.`;
    cursor = page.next;
  } while (cursor);
  return undefined;
}

/** lists.delete: removes the list and its memberships; people stay. Refused while rules or sequences use it. */
export async function deleteList(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id"]);
  const id = str(input.id, "list", 300);
  const list = await ctx.store.getList(id);
  if (!list) return { deleted: false };
  if (list.system) throw new Error("System lists cannot be deleted.");
  assertListVisible(ctx, list);
  const inUse = await listInUse(ctx, id);
  if (inUse) throw new Error(`${inUse} Change or delete it first.`);
  await requireAutonomy(ctx, await readableAccountIds(ctx), "audience");
  const deleted = await ctx.store.deleteList(id);
  await chargeAutonomy(ctx, await readableAccountIds(ctx), "audience", 1);
  return { deleted };
}

function memberInput(input: Record<string, unknown>) {
  exact(input, ["listId", "personIds"]);
  return {
    listId: str(input.listId, "list", 300),
    personIds: array(input.personIds, "people", MAX_BATCH),
  };
}

/**
 * lists.addMembers: static lists only. Suppressed or invisible people are skipped and counted.
 * The undo of this action (lists.removeMembers with the same input) is recorded by the dispatcher.
 */
export async function addMembers(ctx: SocialActionContext, input: Record<string, unknown>) {
  const { listId, personIds } = memberInput(input);
  const list = await existingList(ctx, listId);
  if (list.kind !== "static") throw new Error("Dynamic lists are computed from their filter.");
  await requireAutonomy(ctx, await readableAccountIds(ctx), "audience", personIds.length);
  const eligible: string[] = [];
  for (const id of personIds) {
    const person = await ctx.store.getPerson(id);
    if (!person || !(await canSeePerson(ctx, person))) continue;
    if (await identityBlocked(ctx.store, person.handles, person.id)) continue;
    eligible.push(id);
  }
  const added = await ctx.store.addMembers(listId, eligible, {
    source: "manual",
    at: ctx.now(),
  });
  await chargeAutonomy(ctx, await readableAccountIds(ctx), "audience", added);
  return { added, skipped: personIds.length - eligible.length };
}

/** lists.removeMembers: static lists only. The same input is the undo of addMembers. */
export async function removeMembers(ctx: SocialActionContext, input: Record<string, unknown>) {
  const { listId, personIds } = memberInput(input);
  const list = await existingList(ctx, listId);
  if (list.kind !== "static") throw new Error("Dynamic lists are computed from their filter.");
  await requireAutonomy(ctx, await readableAccountIds(ctx), "audience", 1);
  const removed = await ctx.store.removeMembers(listId, personIds);
  await chargeAutonomy(ctx, await readableAccountIds(ctx), "audience", 1);
  return { removed };
}
