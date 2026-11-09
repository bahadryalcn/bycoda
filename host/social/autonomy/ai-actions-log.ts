import { randomUUID } from "node:crypto";
import type { AiAction } from "../../../src/features/social/model/autonomy";
import type { SocialJob } from "../../../src/features/social/model/social";
import { sanitizeSocialError } from "../core/social-helpers";
import type { SocialAudienceStore } from "../store/social-audience-store";
import type { SocialPrincipal } from "../social";

const READ_ACTION =
  /\.(list|get|read|page|status|search|history|preview|stats|summary|report|timeline|features|unified|export|replyOptions|matchSuggestions|settings\.get|preview-schedule|archive-status)$|^(snapshot|workspace\.snapshot|capabilities\.get|policy\.get|accounts\.list|programs\.features|media\.status)$/;

/** Names that do not change state. Everything else is a write and is recorded for AI principals. */
export function isWriteAction(action: string): boolean {
  return !READ_ACTION.test(action);
}

/** Summary text: action, account and a short target. Never message bodies or secrets. */
export function aiActionSummary(action: string, accountId?: string, target?: string): string {
  const parts = [action];
  if (accountId) parts.push(`account ${accountId}`);
  if (target) parts.push(target.slice(0, 80));
  return parts.join(" · ");
}

/** Undo is recorded only where a reverse operation exists. Publishing has none. */
export function aiActionUndo(action: string, input: Record<string, unknown>): AiAction["undo"] {
  if (action === "lists.addMembers") return { action: "lists.removeMembers", input };
  return undefined;
}

/**
 * Awaited write of one AI action. A log failure is reported (sanitized) and never changes the
 * outcome of the action that was already performed.
 */
export async function recordAiAction(store: SocialAudienceStore, action: AiAction): Promise<void> {
  try {
    await store.putAiAction(action);
  } catch (error) {
    console.error("Social AI action log write failed:", sanitizeSocialError(error));
  }
}

export function newAiAction(input: {
  actor: string;
  action: string;
  accountId?: string;
  target?: string;
  status?: AiAction["status"];
  reason?: string;
  input?: Record<string, unknown>;
  at: number;
}): AiAction {
  return {
    id: randomUUID(),
    at: input.at,
    actor: input.actor,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    action: input.action,
    summary: aiActionSummary(input.action, input.accountId, input.target),
    status: input.status ?? "done",
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.input ? { undo: aiActionUndo(input.action, input.input) } : {}),
  };
}

export async function listAiActions(
  store: SocialAudienceStore,
  input: { cursor?: string; accountId?: string; limit?: number } = {},
) {
  return await store.listAiActions(input);
}

/** Records one write made by a non-owner principal. Owner writes are audited elsewhere only. */
export async function recordAiWrite(
  store: SocialAudienceStore,
  principal: SocialPrincipal,
  action: string,
  accountId: string | undefined,
  input: Record<string, unknown>,
  at: number,
): Promise<void> {
  if (principal.kind === "owner" || !isWriteAction(action)) return;
  await recordAiAction(
    store,
    newAiAction({ actor: principal.actorId, action, accountId, input, at }),
  );
}

/** Records an autonomous dispatch. Jobs without an autonomy approval are not AI dispatches. */
export async function recordAutonomousDispatch(
  store: SocialAudienceStore,
  job: SocialJob,
  at: number,
): Promise<void> {
  if (job.approval?.kind !== "autonomy") return;
  await recordAiAction(
    store,
    newAiAction({
      actor: job.actorId,
      action: `autonomy.${job.kind}`,
      accountId: job.accountId,
      at,
    }),
  );
}
