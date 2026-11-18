import { isDeepStrictEqual } from "node:util";
import type {
  InstagramModerationAction,
  InstagramModerationRequest,
} from "../../../src/features/social/model/instagramModeration";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, hash, str } from "../core/social-helpers";

const kind = "instagram-moderation";

function moderationAction(value: unknown): InstagramModerationAction {
  if (value === "hide" || value === "unhide" || value === "delete") return value;
  throw new Error("Invalid Instagram moderation action.");
}

async function target(ctx: SocialActionContext, threadId: string, commentId: string) {
  const thread = await ctx.service.thread(threadId);
  if (
    !thread ||
    thread.kind !== "comment" ||
    thread.replyAllowed === false ||
    (ctx.principal.kind !== "owner" && thread.projectId !== ctx.principal.projectId)
  )
    throw new Error("Instagram comment conversation not found.");
  const account = await ctx.service.access(ctx.principal, thread.accountId, "reply");
  if (account.platform !== "instagram" || account.connection === "browser")
    throw new SocialPlatformError("unsupported");
  ctx.service.capability(account, "comments.read");
  const event = thread.events.find(
    (event) => event.direction === "inbound" && event.platformId === commentId,
  );
  if (!thread.projectId || !event || !account.grants[thread.projectId]?.includes("reply"))
    throw new Error("Instagram comment or project access changed.");
  await ctx.service.project(ctx.principal, thread.projectId);
  return { account, thread, event, projectId: thread.projectId };
}

async function decide(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id", "reviewed", "decision"]);
  if (input.decision !== "approve" && input.decision !== "dismiss")
    throw new Error("Choose approve or dismiss.");
  const id = str(input.id, "moderation request", 500);
  const request = await ctx.store.getRecord(kind, id);
  if (!request || request.status !== "pending" || !isDeepStrictEqual(input.reviewed, request))
    throw new Error("Review the current Instagram moderation request.");
  const approve = input.decision === "approve";
  const credential = approve ? await ctx.service.credentialFor(request.accountId) : undefined;
  if (approve && !credential?.accessToken) throw new SocialPlatformError("expired");
  const claim = await ctx.store.transaction(async () => {
    const current = await ctx.store.getRecord(kind, id);
    if (!isDeepStrictEqual(current, request))
      throw new Error("This Instagram moderation request already changed.");
    if (!approve)
      return { saved: await ctx.store.putRecord(kind, id, { ...request, status: "dismissed" }) };
    const { account, event, projectId } = await target(ctx, request.threadId, request.commentId);
    if (
      account.id !== request.accountId ||
      account.platformId !== request.platformAccountId ||
      event.id !== request.eventId ||
      hash(event.text) !== request.commentDigest ||
      projectId !== request.projectId
    )
      throw new Error("The Instagram comment changed after review.");
    const adapter = ctx.service.adapterFor(account);
    if (!adapter.instagramCommentAction) throw new SocialPlatformError("unsupported");
    const saved = await ctx.store.putRecord(kind, id, { ...request, status: "attempting" });
    return {
      saved,
      dispatch: () =>
        adapter.instagramCommentAction!(
          account,
          credential!.accessToken,
          request.commentId,
          request.action,
        ),
    };
  });
  if (!claim.dispatch) return claim.saved;
  try {
    await claim.dispatch();
  } catch {
    // Preserve the attempt even when the provider response is lost. No automatic retry.
    return ctx.store.putRecord(kind, id, { ...request, status: "uncertain" });
  }
  return ctx.store.putRecord(kind, id, { ...request, status: "applied" });
}

export const instagramModerationRequests: SocialActionModule = {
  "instagram.comments.request": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["threadId", "commentId", "action"]);
      const threadId = str(input.threadId, "conversation", 200);
      const commentId = str(input.commentId, "comment", 100);
      const action = moderationAction(input.action);
      return ctx.store.transaction(async () => {
        const { account, event, projectId } = await target(ctx, threadId, commentId);
        const existing = await ctx.store.activeInstagramModeration(threadId, commentId, action);
        if (existing)
          return { id: existing.id, accountId: account.id, threadId, status: existing.status };
        const createdAt = ctx.now();
        const id = `${encodeURIComponent(threadId)}/${String(createdAt).padStart(16, "0")}/${ctx.operationId}`;
        const request: InstagramModerationRequest = {
          id,
          accountId: account.id,
          platformAccountId: account.platformId,
          projectId,
          threadId,
          commentId,
          eventId: event.id,
          commentDigest: hash(event.text),
          action,
          status: "pending",
          createdAt,
        };
        await ctx.store.putRecord(kind, id, request);
        return { id, accountId: account.id, threadId, status: request.status };
      });
    },
  },
  "instagram.comments.requests.list": {
    readOnly: true,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["threadId", "before"]);
      const threadId = str(input.threadId, "conversation", 200);
      const thread = await ctx.service.thread(threadId);
      const page = await ctx.store.instagramModerationRequests(
        threadId,
        input.before === undefined ? undefined : str(input.before, "cursor", 500),
      );
      return {
        ...page,
        requests: page.requests.map((request) => {
          const event = thread?.events.find(
            (event) =>
              event.id === request.eventId &&
              event.platformId === request.commentId &&
              hash(event.text) === request.commentDigest,
          );
          return { ...request, ...(event ? { commentText: event.text } : {}) };
        }),
      };
    },
  },
  "instagram.comments.requests.decide": { readOnly: false, ownerOnly: true, run: decide },
};
