import { randomUUID } from "node:crypto";
import type { CaptureRule } from "../../../src/features/social/model/audience";
import { exact, str } from "../core/social-helpers";
import type { SocialActionContext } from "../core/social-actions";
import {
  assertListVisible,
  chargeAutonomy,
  readableAccountIds,
  requireAutonomy,
} from "./audience-access";
import {
  parseCaptureAction,
  parseCaptureFilter,
  parseCaptureSource,
  parseCursor,
  parseLimit,
} from "./audience-validation";

/** Accounts a rule reads from: its own account, or every readable account for the system rule. */
async function ruleAccounts(ctx: SocialActionContext, rule: CaptureRule): Promise<string[]> {
  if (!rule.source.accountId) return await readableAccountIds(ctx);
  await ctx.service.access(ctx.principal, rule.source.accountId, "read");
  return [rule.source.accountId];
}

/** captureRules.list: rules of accounts the principal can read. */
export async function listRules(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["cursor", "limit"]);
  const page = await ctx.store.listRecords("capture-rule", {
    cursor: parseCursor(input.cursor),
    limit: parseLimit(input.limit, 200, 50),
  });
  const readable = new Set(await readableAccountIds(ctx));
  const items =
    ctx.principal.kind === "owner"
      ? page.items
      : page.items.filter((rule) => !rule.source.accountId || readable.has(rule.source.accountId));
  return { items, ...(page.next ? { next: page.next } : {}) };
}

/**
 * captureRules.save: a rule fills one static list from one account. Only the owner or autonomy
 * "audience" can save. The system Commenters rule may only be switched on or off.
 */
export async function saveRule(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id", "name", "enabled", "source", "filter", "targetListId", "action"]);
  const id = input.id === undefined ? randomUUID() : str(input.id, "rule", 300);
  const previous = await ctx.store.getRecord("capture-rule", id);
  if (previous?.system) {
    if (Object.keys(input).some((key) => key !== "id" && key !== "enabled"))
      throw new Error("The system Commenters rule can only be turned on or off.");
    return await setEnabledOf(ctx, previous, input.enabled === true);
  }
  if (previous) await ruleAccounts(ctx, previous);
  const source = parseCaptureSource(input.source);
  await ctx.service.access(ctx.principal, source.accountId, "read");
  const targetListId = str(input.targetListId, "list", 300);
  const list = await ctx.store.getList(targetListId);
  if (!list) throw new Error("List not found.");
  if (list.kind !== "static") throw new Error("A capture rule fills a static list.");
  assertListVisible(ctx, list);
  const action = parseCaptureAction(input.action);
  if (action?.kind === "enroll" && !(await ctx.store.getRecord("sequence", action.sequenceId)))
    throw new Error("Sequence not found.");
  const enabled = input.enabled === true;
  await requireAutonomy(ctx, [source.accountId], "audience");
  const rule: CaptureRule = {
    id,
    name: str(input.name, "rule name", 120),
    enabled,
    source,
    filter: parseCaptureFilter(input.filter),
    targetListId,
    ...(action ? { action } : {}),
    createdAt: previous?.createdAt ?? ctx.now(),
  };
  const saved = await ctx.store.putRecord("capture-rule", id, rule);
  await chargeAutonomy(ctx, [source.accountId], "audience", 1);
  return saved;
}

/** Access check first (non-owners), then autonomy when switching on. */
async function setEnabledOf(ctx: SocialActionContext, rule: CaptureRule, enabled: boolean) {
  const accounts = await ruleAccounts(ctx, rule);
  if (enabled) await requireAutonomy(ctx, accounts, "audience");
  return await ctx.store.putRecord("capture-rule", rule.id, { ...rule, enabled });
}

/** captureRules.setEnabled: turning a rule on needs owner or autonomy "audience"; turning it off does not. */
export async function setRuleEnabled(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id", "enabled"]);
  if (typeof input.enabled !== "boolean") throw new Error("Invalid enabled flag.");
  const rule = await ctx.store.getRecord("capture-rule", str(input.id, "rule", 300));
  if (!rule) throw new Error("Capture rule not found.");
  return await setEnabledOf(ctx, rule, input.enabled);
}

/** captureRules.delete: the system Commenters rule cannot be deleted, only switched off. */
export async function deleteRule(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id"]);
  const rule = await ctx.store.getRecord("capture-rule", str(input.id, "rule", 300));
  if (!rule) return { deleted: false };
  if (rule.system)
    throw new Error("The system Commenters rule cannot be deleted. Turn it off instead.");
  const accounts = await ruleAccounts(ctx, rule);
  await requireAutonomy(ctx, accounts, "audience");
  const deleted = await ctx.store.deleteRecord("capture-rule", rule.id);
  await chargeAutonomy(ctx, accounts, "audience", 1);
  return { deleted };
}
