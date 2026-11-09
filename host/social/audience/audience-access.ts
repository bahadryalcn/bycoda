import type { AutonomyAction } from "../../../src/features/social/model/autonomy";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { SocialActionContext } from "../core/social-actions";
import { autonomyLimit, policyDay, readAutonomyPolicy } from "../autonomy/autonomy-policy";

export const NEEDS_OWNER_APPROVAL = "Needs owner approval";

const unique = (values: string[]) => [...new Set(values)];

/**
 * Non-owner writes need the account's autonomy level to be "autonomous" for every named account.
 * Owner writes pass. `units` is checked against the day's limit; charging happens after the work.
 */
export async function requireAutonomy(
  ctx: SocialActionContext,
  accountIds: string[],
  action: AutonomyAction,
  units = 1,
): Promise<void> {
  if (ctx.principal.kind === "owner") return;
  const accounts = unique(accountIds);
  if (!accounts.length) throw new Error(NEEDS_OWNER_APPROVAL);
  for (const accountId of accounts) {
    const decision = await ctx.service.authorizeAutonomous({
      accountId,
      action,
      principal: ctx.principal,
    });
    if (decision.mode !== "autonomous") throw new Error(NEEDS_OWNER_APPROVAL);
    const policy = await readAutonomyPolicy(ctx.store, accountId);
    const day = policyDay(policy, ctx.now());
    const counted = await ctx.store.getCounter(accountId, action, day);
    if (counted + units > autonomyLimit(policy, action))
      throw new Error("Daily AI limit reached for this account and action.");
  }
}

/** Adds the units of a finished non-owner write to the day's counters. Owner writes are not counted. */
export async function chargeAutonomy(
  ctx: SocialActionContext,
  accountIds: string[],
  action: AutonomyAction,
  units: number,
): Promise<void> {
  if (ctx.principal.kind === "owner" || units < 1) return;
  for (const accountId of unique(accountIds)) {
    const policy = await readAutonomyPolicy(ctx.store, accountId);
    await ctx.store.incrementCounter(accountId, action, policyDay(policy, ctx.now()), units);
  }
}

/** Accounts the principal can read. Owners get every account. */
export async function readableAccountIds(ctx: SocialActionContext): Promise<string[]> {
  return (await ctx.service.accounts(ctx.principal)).map((account) => account.id);
}

/**
 * A non-owner sees a person only inside its own project and only when it can read at least one
 * of the person's accounts. Owners see everyone.
 */
export async function canSeePerson(
  ctx: SocialActionContext,
  person: SocialPerson,
): Promise<boolean> {
  if (ctx.principal.kind === "owner") return true;
  const projectId = ctx.principal.projectId;
  if (!projectId || !person.projectIds.includes(projectId)) return false;
  for (const handle of person.handles) {
    const readable = await ctx.service.access(ctx.principal, handle.accountId, "read").then(
      () => true,
      () => false,
    );
    if (readable) return true;
  }
  return false;
}

export async function visiblePeople(
  ctx: SocialActionContext,
  people: SocialPerson[],
): Promise<SocialPerson[]> {
  const visible: SocialPerson[] = [];
  for (const person of people) if (await canSeePerson(ctx, person)) visible.push(person);
  return visible;
}

/** The person, or "Person not found." when it does not exist or the principal cannot see it. */
export async function requirePerson(ctx: SocialActionContext, id: string): Promise<SocialPerson> {
  const person = await ctx.store.getPerson(id);
  if (!person || !(await canSeePerson(ctx, person))) throw new Error("Person not found.");
  return person;
}

/** Non-owners only touch lists of their own project. System lists have no project and stay owner-only. */
export function assertListVisible(ctx: SocialActionContext, list: { projectIds: string[] }): void {
  if (ctx.principal.kind === "owner") return;
  if (!ctx.principal.projectId || !list.projectIds.includes(ctx.principal.projectId))
    throw new Error("Private audience data belongs to another project.");
}

export function accountIdsOf(person: SocialPerson): string[] {
  return unique(person.handles.map((handle) => handle.accountId));
}
