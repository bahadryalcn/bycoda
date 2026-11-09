import type { SocialAccount } from "../../../src/features/social/model/social";
import type {
  CollectedPerson,
  CaptureSource,
} from "../../../src/integrations/social/audience-types";
import type { SocialAdapter } from "../../../src/integrations/social/adapter";
import { accountCapabilities } from "../../../src/integrations/social/capabilities";
import type { SocialActionContext } from "../core/social-actions";
import { exact, sanitizeSocialError, str } from "../core/social-helpers";
import { chargeAutonomy, requireAutonomy } from "./audience-access";
import { ensurePerson, identityBlocked, interactionId } from "./audience-person";
import { parseCaptureSource, parseCursor, parseLimit } from "./audience-validation";

export type CollectResult = {
  collected: number;
  skipped: number;
  failed?: number;
  error?: string;
  unsupported?: string;
  next?: string;
};

const MAX_PEOPLE = 500;

const unsupported = (reasonCode: string): CollectResult => ({
  collected: 0,
  skipped: 0,
  unsupported: reasonCode,
});

/** Projects a collected person joins: the owner gets every granted project, others only their own. */
function projectsFor(ctx: SocialActionContext, account: SocialAccount): string[] {
  if (ctx.principal.kind === "owner") {
    const granted = Object.keys(account.grants);
    if (!granted.length) throw new Error("This account has no project grant.");
    return granted;
  }
  if (!ctx.principal.projectId) throw new Error("Choose a project for this collection.");
  return [ctx.principal.projectId];
}

async function collectOne(
  ctx: SocialActionContext,
  account: SocialAccount,
  item: CollectedPerson,
  source: CaptureSource,
  listId: string | undefined,
  projectIds: string[],
): Promise<"collected" | "skipped"> {
  if (!item.platformId) return "skipped";
  const existing = await ctx.store.findPersonByHandle(account.id, item.platformId);
  const identity = { platform: account.platform, platformId: item.platformId };
  if (await identityBlocked(ctx.store, [identity], existing?.id)) return "skipped";
  const contact = await ctx.service.upsertContact(ctx.principal, {
    accountId: account.id,
    platformId: item.platformId,
    name: item.name || item.username || item.platformId,
    ...(item.profileUrl ? { profileUrl: item.profileUrl } : {}),
    ...(existing ? {} : { projectIds }),
  });
  const { person } = await ensurePerson(
    ctx.store,
    account,
    contact,
    { source: item.kind, basis: "none" },
    ctx.now(),
    projectIds,
  );
  await ctx.store.addInteraction({
    id: interactionId([account.id, item.platformId, item.kind, item.ref ?? "", source.kind]),
    personId: person.id,
    accountId: account.id,
    platform: account.platform,
    kind: item.kind,
    ...(item.ref ? { ref: item.ref } : {}),
    ...(item.text ? { text: item.text.slice(0, 2000) } : {}),
    at: item.at,
    direction: "inbound",
  });
  if (listId)
    await ctx.store.addMembers(listId, [person.id], {
      source: `capture:${source.kind}`,
      at: ctx.now(),
    });
  return "collected";
}

/**
 * audience.collect: one adapter page of people for a source, saved as contacts, people and
 * interactions. Without a supported operation the result says why (no silent success). Suppressed
 * people are skipped. Adapter results beyond `limit` are reported as skipped, not dropped silently.
 */
export async function collectAudience(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<CollectResult> {
  exact(input, ["source", "targetListId", "limit", "cursor"]);
  const source = parseCaptureSource(input.source);
  const limit = parseLimit(input.limit, MAX_PEOPLE, 100);
  const cursor = parseCursor(input.cursor);
  const account = await ctx.service.access(ctx.principal, source.accountId, "read");
  const capability = accountCapabilities(account, ctx.now()).find(
    (item) => item.operation === "audience.collect",
  );
  if (!capability || capability.status !== "available")
    return unsupported(capability?.reasonCode ?? "audience.collect.missing");
  let adapter: SocialAdapter;
  try {
    adapter = ctx.service.adapterFor(account);
  } catch {
    return unsupported("adapter.unavailable");
  }
  if (!adapter.collectAudience) return unsupported("audience.collect.not_implemented");
  const listId =
    input.targetListId === undefined ? undefined : str(input.targetListId, "list", 300);
  if (listId) {
    const list = await ctx.store.getList(listId);
    if (!list) throw new Error("List not found.");
    if (list.kind !== "static") throw new Error("Collected people fill a static list.");
  }
  const credential = await ctx.service.credentialFor(account.id);
  if (!credential) throw new Error("This account is not connected. Reconnect it first.");
  await requireAutonomy(ctx, [account.id], "audience");
  const page = await adapter.collectAudience(account, credential.accessToken, source, cursor);
  if (page.people.length > MAX_PEOPLE) throw new Error("The source returned too many people.");
  const projectIds = projectsFor(ctx, account);
  const people = page.people.slice(0, limit);
  const overLimit = page.people.length - people.length;
  let collected = 0;
  let skipped = overLimit;
  let failed = 0;
  let firstError: unknown;
  for (const item of people) {
    try {
      if ((await collectOne(ctx, account, item, source, listId, projectIds)) === "collected")
        collected++;
      else skipped++;
    } catch (error) {
      failed++;
      firstError ??= error;
    }
  }
  await chargeAutonomy(ctx, [account.id], "audience", collected);
  return {
    collected,
    skipped,
    ...(failed ? { failed, error: sanitizeSocialError(firstError) } : {}),
    ...(page.next ? { next: page.next } : {}),
  };
}
