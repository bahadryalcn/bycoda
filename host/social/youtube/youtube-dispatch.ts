import {
  autonomyLevel,
  withinWorkingHours,
  type AutonomyAction,
} from "../../../src/features/social/model/autonomy";
import type { SocialPermission } from "../../../src/features/social/model/social";
import type {
  YouTubeOperation,
  YouTubeWriteAction,
} from "../../../src/features/social/model/youtubeManagement";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { dateTimeFormat } from "../../../src/shared/lib/intl";
import { autonomyLimit, policyDay, readAutonomyPolicy } from "../autonomy/autonomy-policy";
import { assertAiRunnable } from "../autonomy/autonomy-gate";
import type { SocialActionContext } from "../core/social-actions";
import { hash } from "../core/social-helpers";
import type { AudienceRecordValue } from "../store/social-audience-store";
import { youtubeAccount, youtubeRuntime } from "./youtube-runtime";

type RecordValue = AudienceRecordValue["youtube-operation"];
type Dispatch = (guard: () => Promise<void>) => Promise<unknown>;

export type YouTubeDispatchPolicy = {
  permission: SocialPermission;
  autonomy: AutonomyAction;
  outbound?: boolean;
  ownerMedia?: boolean;
  subscription?: boolean;
};

const pacificDate = dateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  dateStyle: "short",
});
const SUBSCRIPTION_LIMIT = 10;

export function publicYouTubeOperation(row: RecordValue): YouTubeOperation {
  const {
    actorId: _actorId,
    projectId: _projectId,
    channelId: _channelId,
    fingerprint: _fingerprint,
    submittedAt: _submittedAt,
    ...operation
  } = row;
  return operation.status === "submitted" ? { ...operation, status: "unknown" } : operation;
}

export async function readYouTubeOperation(
  ctx: SocialActionContext,
  accountId: string,
  id: string,
) {
  await ctx.service.access(ctx.principal, accountId, "read");
  const row = await ctx.store.getRecord("youtube-operation", id);
  if (
    !row ||
    row.accountId !== accountId ||
    (ctx.principal.kind !== "owner" &&
      (row.actorId !== ctx.principal.actorId || row.projectId !== ctx.principal.projectId))
  )
    throw new Error("YouTube operation not found.");
  return row;
}

async function execute(
  ctx: SocialActionContext,
  row: RecordValue,
  policy: YouTubeDispatchPolicy,
  dispatch: Dispatch,
  autonomyVersion?: number,
) {
  let submitted = false;
  const guard = async () => {
    await youtubeRuntime(ctx).assertAuthorized();
    const { permission, autonomy, outbound, subscription } = policy;
    const account = await youtubeAccount(ctx, row.accountId, permission);
    if (
      account.platformId !== row.channelId ||
      (row.projectId && !account.grants[row.projectId]?.includes(permission))
    )
      throw new SocialPlatformError("denied");
    if (
      outbound &&
      ((await ctx.service.setting("stopped")) === "true" ||
        (await ctx.service.setting("sending")) !== "true")
    )
      throw new Error("External Social sending is stopped.");
    if (
      (ctx.principal.kind !== "owner" || row.projectId) &&
      (await ctx.service.setting("ai.stopped")) === "true"
    )
      throw new Error("AI actions are stopped by the owner.");
    if (outbound)
      await ctx.service.assertSendable(
        {
          platform: "youtube",
          platformId: account.platformId.replace(/^web:youtube:/, ""),
        },
        "comment",
      );
    await ctx.store.transaction(async () => {
      const current = await ctx.store.getRecord("youtube-operation", row.id);
      if (!current || current.status !== (submitted ? "submitted" : "awaiting_approval"))
        throw new Error("This YouTube operation already started. Check its status.");
      const unresolved = await ctx.store.unresolvedYouTubeOperation(row.fingerprint);
      if (unresolved && unresolved.id !== row.id)
        throw new Error("An identical YouTube operation needs outcome review.");
      if (autonomyVersion !== undefined) {
        await assertAiRunnable({
          audience: ctx.store,
          setting: (key) => ctx.service.setting(key),
          now: ctx.now,
        });
        const currentPolicy = await readAutonomyPolicy(ctx.store, account.id);
        if (
          currentPolicy.version !== autonomyVersion ||
          autonomyLevel(currentPolicy, autonomy) !== "autonomous" ||
          !withinWorkingHours(currentPolicy, ctx.now())
        )
          throw new Error(
            "YouTube action requires a new review under the current autonomy policy.",
          );
        if (!submitted) {
          const day = policyDay(currentPolicy, ctx.now());
          if (
            (await ctx.store.getCounter(account.id, autonomy, day)) >=
            autonomyLimit(currentPolicy, autonomy)
          )
            throw new Error("Daily AI limit reached for this account and action.");
          await ctx.store.incrementCounter(account.id, autonomy, day);
        }
      }
      if (subscription && !submitted) {
        const day = pacificDate.format(ctx.now());
        if (
          (await ctx.store.getCounter(account.platformId, "youtube.subscription", day)) >=
          SUBSCRIPTION_LIMIT
        )
          throw new Error("Daily YouTube subscription limit reached.");
        await ctx.store.incrementCounter(account.platformId, "youtube.subscription", day);
      }
      if (!submitted)
        await ctx.store.putRecord("youtube-operation", row.id, {
          ...row,
          status: "submitted",
          submittedAt: ctx.now(),
        });
    });
    submitted = true;
  };
  try {
    const result = await dispatch(guard);
    return await ctx.store.transaction(async () => {
      const current = await ctx.store.getRecord("youtube-operation", row.id);
      if (!current) throw new Error("YouTube operation record is unavailable.");
      if (current.status !== (submitted ? "submitted" : "awaiting_approval"))
        return publicYouTubeOperation(current);
      const partial =
        result && typeof result === "object" && "status" in result && result.status === "partial";
      return publicYouTubeOperation(
        await ctx.store.putRecord("youtube-operation", row.id, {
          ...row,
          status: partial ? "unknown" : "done",
          result,
        }),
      );
    });
  } catch (error) {
    if (!submitted) {
      if (error instanceof SocialPlatformError && error.code === "needs_human")
        return {
          ...publicYouTubeOperation(row),
          status: "needs_human",
          reason: error.detail?.reasonCode ?? error.code,
        };
      throw error;
    }
    const reason =
      error instanceof SocialPlatformError ? (error.detail?.reasonCode ?? error.code) : "unknown";
    const status =
      error instanceof SocialPlatformError && error.code !== "unknown" ? "rejected" : "unknown";
    return publicYouTubeOperation(
      await ctx.store.putRecord("youtube-operation", row.id, { ...row, status, reason }),
    );
  }
}

export async function reconcileYouTubeOperation(
  ctx: SocialActionContext,
  accountId: string,
  id: string,
  status: "done" | "rejected",
) {
  return await ctx.store.transaction(async () => {
    const row = await readYouTubeOperation(ctx, accountId, id);
    const inactive =
      row.status === "submitted" &&
      row.submittedAt !== undefined &&
      ctx.now() - row.submittedAt >= 10 * 60 * 1000;
    if (row.status !== "unknown" && !inactive)
      throw new Error("Only an uncertain YouTube operation can be reconciled.");
    return publicYouTubeOperation(
      await ctx.store.putRecord("youtube-operation", id, {
        ...row,
        status,
        reason: "owner_verified",
      }),
    );
  });
}

export async function submitYouTubeOperation(
  ctx: SocialActionContext,
  action: YouTubeWriteAction,
  input: Record<string, unknown> & { accountId: string },
  policy: YouTubeDispatchPolicy,
  dispatch: Dispatch,
  approved?: RecordValue,
) {
  const account = await youtubeAccount(ctx, input.accountId, policy.permission);
  if (approved?.status !== undefined && approved.status !== "awaiting_approval")
    return publicYouTubeOperation(approved);
  const fingerprint = hash(JSON.stringify([account.platformId, action, input]));
  const id =
    approved?.id ??
    hash(
      JSON.stringify([
        ctx.principal.actorId,
        ctx.principal.projectId,
        ctx.youtubeRequestId ?? fingerprint,
      ]),
    );
  const decision =
    ctx.principal.kind === "owner"
      ? undefined
      : await ctx.service.authorizeAutonomous({
          accountId: account.id,
          action: policy.autonomy,
          principal: ctx.principal,
        });
  if (decision?.mode === "suggest")
    return { accountId: account.id, action, input, status: "suggested" as const };
  const row = await ctx.store.transaction(async () => {
    const current = await ctx.store.getRecord("youtube-operation", id);
    if (current) {
      if (current.fingerprint !== fingerprint)
        throw new Error("Request ID was already used with another YouTube operation.");
      return current;
    }
    if (await ctx.store.unresolvedYouTubeOperation(fingerprint))
      throw new Error("An identical YouTube operation needs outcome review.");
    return await ctx.store.putRecord("youtube-operation", id, {
      id,
      action,
      input,
      fingerprint,
      accountId: account.id,
      channelId: account.platformId,
      actorId: ctx.principal.actorId,
      projectId: ctx.principal.projectId,
      status: "awaiting_approval",
      createdAt: ctx.now(),
    });
  });
  if (row.status !== "awaiting_approval") return publicYouTubeOperation(row);
  if (!decision) return await execute(ctx, row, policy, dispatch);
  if (decision.mode === "approve" || policy.ownerMedia || decision.scheduledAt > ctx.now())
    return publicYouTubeOperation(row);
  return await execute(ctx, row, policy, dispatch, decision.approval.version);
}
