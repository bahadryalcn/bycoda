import type { AiAction } from "../../../src/features/social/model/autonomy";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { array, exact, str } from "../core/social-helpers";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { listAiActions, newAiAction, recordAiAction } from "../autonomy/ai-actions-log";
import { callAction } from "./ai-host";
import { planCommand } from "./ai-command";
import { runPlan } from "./ai-plan-run";
import { report, summarize } from "./ai-summary";

const UNDO_SCAN_PAGES = 20;

/**
 * Finds one AI action row. shortcut: a bounded scan of 4,000 rows, newest first. Upgrade: an indexed
 * get in the store once Social reopens it.
 */
async function findAiAction(store: SocialAudienceStore, id: string): Promise<AiAction | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < UNDO_SCAN_PAGES; page++) {
    const result = await listAiActions(store, { cursor, limit: 200 });
    const hit = result.items.find((item) => item.id === id);
    if (hit) return hit;
    if (!result.next) return undefined;
    cursor = result.next;
  }
  return undefined;
}

/** Reverses an action that recorded its inverse. Dispatches the inverse through the normal gates. */
async function undoAction(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<AiAction> {
  exact(input, ["actionId"]);
  const id = str(input.actionId, "AI action", 100);
  const action = await findAiAction(ctx.store, id);
  if (!action) throw new Error("AI action not found.");
  if (action.status === "undone") throw new Error("This action was already undone.");
  if (!action.undo) throw new Error("This action cannot be undone.");
  await callAction(ctx, ctx.principal, action.undo.action, action.undo.input, `undo-${action.id}`);
  const undone: AiAction = { ...action, status: "undone" };
  await recordAiAction(
    ctx.store,
    newAiAction({
      actor: ctx.principal.actorId,
      action: action.undo.action,
      accountId: action.accountId,
      reason: `Undo of ${action.id}`,
      at: ctx.now(),
    }),
  );
  await recordAiAction(ctx.store, undone);
  return undone;
}

/** Non-owner principals see only rows for accounts they can read. Owners see everything. */
async function listActions(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["cursor", "accountId"]);
  const cursor = input.cursor === undefined ? undefined : str(input.cursor, "cursor", 200);
  const accountId = input.accountId === undefined ? undefined : str(input.accountId, "account");
  if (accountId) await ctx.service.access(ctx.principal, accountId, "read");
  const page = await listAiActions(ctx.store, { cursor, accountId, limit: 50 });
  if (ctx.principal.kind === "owner") return page;
  const readable = new Set(
    (await ctx.service.accounts(ctx.principal)).map((account) => account.id),
  );
  return {
    items: page.items.filter(
      (item) => item.accountId !== undefined && readable.has(item.accountId),
    ),
    ...(page.next ? { next: page.next } : {}),
  };
}

/**
 * AI command planning, plan execution, action log and undo, global AI stop and reports. Every
 * operation a plan runs is dispatched through SocialService.call, the same path the UI uses.
 */
export const aiActions: SocialActionModule = {
  "ai.command": {
    readOnly: false,
    ownerOnly: false,
    run: async (ctx, input) => {
      exact(input, ["text", "projectId"]);
      return await planCommand(ctx, input);
    },
  },
  "ai.plan.run": {
    readOnly: false,
    ownerOnly: false,
    run: async (ctx, input) => {
      exact(input, ["planId", "approvedStepIds"]);
      return await runPlan(ctx, {
        planId: str(input.planId, "plan", 100),
        approvedStepIds:
          input.approvedStepIds === undefined
            ? []
            : array(input.approvedStepIds, "approved steps", 12),
      });
    },
  },
  "ai.actions.list": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => await listActions(ctx, input),
  },
  "ai.actions.undo": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => await undoAction(ctx, input),
  },
  // Any principal may stop AI; only the owner resumes it. Stop is never held by the stop itself.
  "ai.stop": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: async (ctx) => {
      await ctx.service.setSetting("ai.stopped", "true");
      return { aiStopped: true };
    },
  },
  "ai.resume": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      exact(input, []);
      await ctx.service.setSetting("ai.stopped", "false");
      return { aiStopped: false };
    },
  },
  "ai.summary": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, []);
      return await summarize(ctx);
    },
  },
  "ai.report": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["period"]);
      if (input.period !== "day" && input.period !== "week") throw new Error("Choose day or week.");
      return await report(ctx, input.period);
    },
  },
};
