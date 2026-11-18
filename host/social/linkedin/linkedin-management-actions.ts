import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SocialThread } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import {
  linkedInManagementScope,
  linkedInReactions,
  type LinkedInManagementAction,
  type LinkedInManagementReview,
} from "../../../src/integrations/social/adapters/linkedin-manage";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, hash, str } from "../core/social-helpers";
import { ownedLinkedInPublication } from "./linkedin-publication";

const reviewKind = "linkedin-management-review";
const reviewWindow = 10 * 60_000;
const postUrn = /^urn:li:(?:share|ugcPost):[1-9]\d{0,24}$/;
const commentUrn =
  /^urn:li:comment:\(urn:li:(?:activity|share|ugcPost):[1-9]\d{0,24},[1-9]\d{0,24}\)$/;

function actionTarget(action: LinkedInManagementAction) {
  if (action.kind === "deleteComment") return action.commentId;
  return "postId" in action ? action.postId : action.entityId;
}

/** An unresolved write blocks other reviewed changes to the same provider resource. */
function attemptKey(actor: string, action: LinkedInManagementAction) {
  return `attempt:${hash(JSON.stringify([actor, actionTarget(action)]))}`;
}

async function prepare(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["accountId", "kind", "jobId", "threadId", "text", "reaction"]);
  const accountId = str(input.accountId, "account");
  const kind = input.kind;
  if (
    kind !== "editPost" &&
    kind !== "deletePost" &&
    kind !== "deleteComment" &&
    kind !== "react" &&
    kind !== "removeReaction"
  )
    throw new SocialPlatformError("unsupported");
  const postChange = kind === "editPost" || kind === "deletePost";
  const permission = postChange ? "publish" : "comment";
  const account = await ctx.service.access(ctx.principal, accountId, permission);
  if (
    !account.connected ||
    !account.accessApproved ||
    account.connection !== "oauth" ||
    account.platform !== "linkedin"
  )
    throw new SocialPlatformError("unsupported");

  let action: LinkedInManagementAction;
  let source: LinkedInManagementReview["source"];
  let contactId: string | undefined;
  if (postChange) {
    if (
      input.threadId !== undefined ||
      input.reaction !== undefined ||
      (kind === "deletePost" && input.text !== undefined)
    )
      throw new Error("Use only the fields for the selected LinkedIn operation.");
    const jobId = str(input.jobId, "publication job");
    const postId = await ownedLinkedInPublication(ctx, accountId, jobId);
    action =
      kind === "editPost"
        ? { kind, postId, text: str(input.text, "post text", 3000) }
        : { kind, postId };
    source = { kind: "publication", id: jobId };
  } else {
    if (
      input.jobId !== undefined ||
      input.text !== undefined ||
      (kind !== "react" && input.reaction !== undefined)
    )
      throw new Error("Use only the fields for the selected LinkedIn operation.");
    const thread = (await ctx.service.call(ctx.principal, "thread.read", {
      id: str(input.threadId, "comment thread"),
    })) as SocialThread;
    if (
      thread.accountId !== accountId ||
      thread.kind !== "comment" ||
      !thread.platformPostId ||
      !commentUrn.test(thread.platformThreadId)
    )
      throw new SocialPlatformError("denied");
    source = {
      kind: "thread",
      id: thread.id,
      postId: thread.platformPostId,
      ...(thread.projectId ? { projectId: thread.projectId } : {}),
    };
    contactId = thread.contactId;
    await ctx.service.assertSendable({ contactId }, "comment");
    const entityId = thread.platformThreadId;
    if (kind === "deleteComment") {
      if (!postUrn.test(thread.platformPostId)) throw new SocialPlatformError("unsupported");
      action = { kind, postId: thread.platformPostId, commentId: entityId };
    } else if (kind === "removeReaction") {
      action = { kind, entityId };
    } else {
      const reaction = linkedInReactions.find((value) => value === input.reaction);
      if (!reaction) throw new Error("Choose a supported LinkedIn reaction.");
      action = { kind, entityId, reaction };
    }
  }
  if (!account.scopes.includes(linkedInManagementScope(account, action.kind)))
    throw new SocialPlatformError("denied");
  const actor = account.platformId;
  const projectId = ctx.principal.projectId;
  const connectionEpoch = await ctx.service.setting(`connectionEpoch:${accountId}`);
  const id = randomUUID();
  return await ctx.store.transaction(async () => {
    if (await ctx.store.getRecord(reviewKind, attemptKey(actor, action)))
      throw new SocialPlatformError("unknown");
    return await ctx.store.putRecord(reviewKind, id, {
      id,
      accountId,
      actor,
      permission,
      action,
      source,
      ...(projectId ? { projectId } : {}),
      ...(contactId ? { contactId } : {}),
      ...(connectionEpoch ? { connectionEpoch } : {}),
      expiresAt: ctx.now() + reviewWindow,
      state: "review",
    });
  });
}

async function reviewFor(ctx: SocialActionContext, input: Record<string, unknown>) {
  const id = str(input.id, "LinkedIn review", 64);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new SocialPlatformError("denied");
  const accountId = str(input.accountId, "account");
  const review = await ctx.store.getRecord(reviewKind, id);
  if (!review || review.accountId !== accountId) throw new SocialPlatformError("denied");
  return review;
}

async function checkSubmission(ctx: SocialActionContext, review: LinkedInManagementReview) {
  const { accountId, projectId, permission, source, action } = review;
  const account = await ctx.service.access(ctx.principal, accountId, permission);
  const grants = projectId ? account.grants[projectId] : undefined;
  if (
    !account.connected ||
    !account.accessApproved ||
    account.paused ||
    account.platformId !== review.actor ||
    account.platform !== "linkedin" ||
    account.connection !== "oauth" ||
    account.executorId !== ctx.store.environmentId ||
    (projectId && (!grants?.includes("read") || !grants.includes(permission))) ||
    review.connectionEpoch !== (await ctx.service.setting(`connectionEpoch:${accountId}`)) ||
    review.expiresAt <= ctx.now() ||
    (await ctx.service.setting("stopped")) === "true" ||
    (await ctx.service.setting("sending")) !== "true" ||
    !account.scopes.includes(linkedInManagementScope(account, action.kind))
  )
    throw new SocialPlatformError("denied");

  if (source.kind === "thread") {
    const thread = await ctx.service.thread(source.id);
    if (
      !thread ||
      thread.accountId !== accountId ||
      thread.kind !== "comment" ||
      thread.projectId !== source.projectId ||
      thread.contactId !== review.contactId ||
      thread.platformPostId !== source.postId ||
      thread.platformThreadId !== actionTarget(action)
    )
      throw new SocialPlatformError("denied");
    await ctx.service.assertSendable({ contactId: thread.contactId }, "comment");
  } else if (actionTarget(action) !== (await ownedLinkedInPublication(ctx, accountId, source.id))) {
    throw new SocialPlatformError("denied");
  }
  return account;
}

async function submit(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id", "accountId", "reviewed"]);
  const review = await reviewFor(ctx, input);
  if (!isDeepStrictEqual(review, input.reviewed))
    throw new Error("LinkedIn review changed. Refresh and review it again.");
  if (review.state !== "review") return review;
  const { accountId, id, action } = review;
  const attemptId = attemptKey(review.actor, action);
  const account = await checkSubmission(ctx, review);
  const adapter = ctx.service.adapterFor(account);
  if (!adapter.linkedinManage) throw new SocialPlatformError("unsupported");
  const credential = await ctx.service.credentialFor(accountId);
  if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
    throw new SocialPlatformError("expired");
  let submitted = false;
  try {
    await adapter.linkedinManage(account, credential.accessToken, action, async () => {
      await ctx.store.transaction(async () => {
        const current = await ctx.store.getRecord(reviewKind, id);
        if (!isDeepStrictEqual(current, review)) throw new SocialPlatformError("denied");
        if (await ctx.store.getRecord(reviewKind, attemptId))
          throw new SocialPlatformError("unknown");
        await checkSubmission(ctx, review);
        const attempting = { ...review, state: "attempting" } as const;
        await ctx.store.putRecord(reviewKind, id, attempting);
        await ctx.store.putRecord(reviewKind, attemptId, attempting);
      });
      submitted = true;
    });
    if (!submitted) throw new SocialPlatformError("unknown");
  } catch (error) {
    if (!submitted) throw error;
    await ctx.store.putRecord(reviewKind, id, { ...review, state: "inspect" });
    throw error instanceof SocialPlatformError ? error : new SocialPlatformError("unknown");
  }
  return await ctx.store.transaction(async () => {
    await ctx.store.deleteRecord(reviewKind, attemptId);
    return await ctx.store.putRecord(reviewKind, id, { ...review, state: "succeeded" });
  });
}

export const linkedinManagementActions: SocialActionModule = {
  "linkedin.management.prepare": { readOnly: false, ownerOnly: false, tool: true, run: prepare },
  "linkedin.management.get": {
    readOnly: true,
    ownerOnly: true,
    run: (ctx, input) => {
      exact(input, ["id", "accountId"]);
      return reviewFor(ctx, input);
    },
  },
  "linkedin.management.submit": { readOnly: false, ownerOnly: true, run: submit },
};
