import { createHash } from "node:crypto";
import type {
  SocialAccount,
  SocialOperation,
  SocialThread,
} from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { FACEBOOK_PAGE_PHOTO_SCOPES } from "../../../src/integrations/social/adapters/facebook-page-edit";
import { facebookPageDeleteTarget } from "../browser/facebook-post-delete";
import { exact, hash, str } from "./social-helpers";
import type { SocialActionContext, SocialActionModule } from "./social-actions";

async function page(ctx: SocialActionContext, accountId: unknown, operation?: SocialOperation) {
  const account = await ctx.service.access(ctx.principal, str(accountId, "account"), "read");
  if (
    account.platform !== "facebook" ||
    account.connection === "browser" ||
    account.accountType !== "page"
  )
    throw new SocialPlatformError("unsupported");
  if (
    !account.connected ||
    !account.accessApproved ||
    account.executorId !== ctx.facebookLive?.environmentId
  )
    throw new SocialPlatformError("denied");
  if (operation) ctx.service.capability(account, operation);
  const adapter = ctx.service.adapterFor(account);
  const credential = await ctx.service.credentialFor(account.id);
  if (!adapter.facebook) throw new SocialPlatformError("unsupported");
  if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
    throw new SocialPlatformError("expired");
  return { account, adapter, operations: adapter.facebook, token: credential.accessToken };
}

function cursor(value: unknown): string | undefined {
  return value === undefined ? undefined : str(value, "cursor", 2000);
}

function postId(account: SocialAccount, value: unknown): string {
  const post = str(value, "post", 120);
  if (!/^\d+_\d+$/.test(post) || !post.startsWith(`${account.platformId}_`))
    throw new Error("Choose a post owned by this Facebook Page.");
  return post;
}

async function commentThread(ctx: SocialActionContext, value: unknown): Promise<SocialThread> {
  const thread = (await ctx.service.call(ctx.principal, "thread.read", {
    id: str(value, "thread"),
  })) as SocialThread;
  if (thread.kind !== "comment") throw new Error("Choose a Facebook Page comment.");
  return thread;
}

async function assertSending(ctx: SocialActionContext, account: SocialAccount) {
  if (
    account.paused ||
    (await ctx.service.setting("stopped")) === "true" ||
    (await ctx.service.setting("sending")) !== "true"
  )
    throw new Error("External sending is stopped.");
}

const pendingPageWrites = new WeakMap<SocialActionContext["service"], Set<string>>();

class PageWriteUnsubmittedError extends Error {
  constructor(cause: unknown) {
    super("Facebook write stopped before submission.", { cause });
  }
}

/** A disconnected caller or Host restart must not replay an unconfirmed Page write. */
async function writePageReceipt<T, Current extends { account: SocialAccount }>(
  ctx: SocialActionContext,
  account: SocialAccount,
  operation: SocialOperation,
  input: unknown,
  recheck: () => Promise<Current>,
  submit: (current: Current) => Promise<T>,
  uncertain?: (result: T) => boolean,
): Promise<T> {
  let pending = pendingPageWrites.get(ctx.service);
  if (!pending) {
    pending = new Set();
    pendingPageWrites.set(ctx.service, pending);
  }
  if (pending.has(account.id)) throw new Error("A Facebook change is already in progress.");
  pending.add(account.id);
  try {
    const key = `facebook.page.unconfirmed:${account.id}`;
    const candidate = hash(JSON.stringify([account.platformId, operation, input]));
    const unconfirmed = new Set<string>(JSON.parse((await ctx.service.setting(key)) ?? "[]"));
    if (unconfirmed.has(candidate)) throw new SocialPlatformError("unknown");
    const current = await recheck();
    if (current.account.platformId !== account.platformId) throw new SocialPlatformError("denied");
    unconfirmed.add(candidate);
    await ctx.service.setSetting(key, JSON.stringify([...unconfirmed]));
    const clear = async () => {
      unconfirmed.delete(candidate);
      await ctx.service.setSetting(key, JSON.stringify([...unconfirmed]));
    };
    try {
      const result = await submit(current);
      if (!uncertain?.(result)) await clear();
      return result;
    } catch (error) {
      if (error instanceof PageWriteUnsubmittedError) {
        await clear();
        throw error.cause;
      }
      if (error instanceof SocialPlatformError && error.code !== "unknown") await clear();
      throw error;
    }
  } finally {
    pending.delete(account.id);
  }
}

function writePage<T>(
  ctx: SocialActionContext,
  account: SocialAccount,
  operation: SocialOperation,
  input: unknown,
  submit: (current: Awaited<ReturnType<typeof page>>) => Promise<T>,
  uncertain?: (result: T) => boolean,
) {
  return writePageReceipt(
    ctx,
    account,
    operation,
    input,
    () => page(ctx, account.id, operation),
    submit,
    uncertain,
  );
}

async function deleteBrowserPagePost(
  ctx: SocialActionContext,
  account: SocialAccount,
  input: unknown,
) {
  const target = facebookPageDeleteTarget(account, input);
  const recheck = async () => {
    const current = await ctx.service.access(ctx.principal, account.id, "read");
    if (
      current.platform !== "facebook" ||
      current.connection !== "browser" ||
      current.accountType !== "page" ||
      current.platformId !== account.platformId ||
      !current.connected ||
      !current.accessApproved ||
      current.executorId !== ctx.store.environmentId
    )
      throw new SocialPlatformError("denied");
    ctx.service.capability(current, "delete");
    await assertSending(ctx, current);
    return { account: current, adapter: ctx.service.adapterFor(current) };
  };
  const receiptTarget = /^\d+$/.test(target.id) ? `${account.platformId}_${target.id}` : target.id;
  await writePageReceipt(ctx, account, "delete", receiptTarget, recheck, async (current) => {
    if (!current.adapter.deletePost) throw new SocialPlatformError("unsupported");
    await current.adapter.deletePost(current.account, "", target.url, async () => {
      try {
        await recheck();
      } catch (error) {
        throw new PageWriteUnsubmittedError(error);
      }
    });
  });
  return { accountId: account.id, postId: target.url, deleted: true };
}

type BeforePageWrite = (account: SocialAccount) => Promise<void>;

export async function editFacebookPagePost(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
  beforeWrite?: BeforePageWrite,
) {
  const { account } = await page(ctx, input.accountId, "post.edit");
  const target = postId(account, input.postId);
  const text = str(input.text, "post text");
  await assertSending(ctx, account);
  return writePage(ctx, account, "post.edit", { target, text }, async (current) => {
    await assertSending(ctx, current.account);
    await current.operations.editPost(current.account, current.token, target, text, async () => {
      try {
        const { account: latest } = await page(ctx, account.id, "post.edit");
        if (
          latest.platformId !== current.account.platformId ||
          latest.connection !== current.account.connection
        )
          throw new SocialPlatformError("denied");
        await assertSending(ctx, latest);
        await ctx.service.assertSendable(
          { platform: "facebook", platformId: latest.platformId },
          "comment",
        );
        await beforeWrite?.(latest);
      } catch (error) {
        throw new PageWriteUnsubmittedError(error);
      }
    });
    return { accountId: account.id, postId: target, edited: true };
  });
}

export async function moderateFacebookPageComment(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
  beforeWrite?: BeforePageWrite,
) {
  const { action } = input;
  if (
    action !== "hide" &&
    action !== "unhide" &&
    action !== "delete" &&
    action !== "like" &&
    action !== "unlike"
  )
    throw new SocialPlatformError("rejected");
  const thread = await commentThread(ctx, input.threadId);
  const { account } = await page(ctx, thread.accountId, "comment.moderate");
  await writePage(
    ctx,
    account,
    "comment.moderate",
    { comment: thread.platformThreadId, action },
    async (current) => {
      try {
        if (action === "like") {
          await assertSending(ctx, current.account);
          await ctx.service.assertSendable({ contactId: thread.contactId }, "comment");
        }
        await beforeWrite?.(current.account);
      } catch (error) {
        throw new PageWriteUnsubmittedError(error);
      }
      await current.operations.moderateComment(current.token, thread.platformThreadId, action);
    },
  );
  return { accountId: account.id, threadId: thread.id, action };
}

export const facebookPageActions: SocialActionModule = {
  "facebook.page.read": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId"]);
      const { account, operations, token } = await page(ctx, input.accountId, "profile.read");
      return operations.profile(account, token);
    },
  },
  "facebook.mentions.list": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "cursor"]);
      const { account, operations, token } = await page(ctx, input.accountId, "mentions.read");
      return operations.mentions(account, token, cursor(input.cursor));
    },
  },
  "facebook.insights.read": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "cursor", "postIds"]);
      const { account, adapter, operations, token } = await page(ctx, input.accountId, "analytics");
      if (input.postIds === undefined)
        return operations.insights(account, token, { cursor: cursor(input.cursor) });
      if (
        input.cursor !== undefined ||
        !Array.isArray(input.postIds) ||
        !input.postIds.length ||
        input.postIds.length > 25 ||
        !adapter.getAnalytics
      )
        throw new SocialPlatformError("rejected");
      return adapter.getAnalytics(account, token, [
        ...new Set(input.postIds.map((post) => postId(account, post))),
      ]);
    },
  },
  "facebook.earnings.read": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "cursor"]);
      const { account, operations, token } = await page(ctx, input.accountId, "analytics");
      return operations.insights(account, token, { earnings: true, cursor: cursor(input.cursor) });
    },
  },
  "facebook.posts.list": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "cursor"]);
      const { account, adapter, token } = await page(ctx, input.accountId, "profile.read");
      if (!adapter.listPosts) throw new SocialPlatformError("unsupported");
      return adapter.listPosts(account, token, cursor(input.cursor));
    },
  },
  "facebook.page.update": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId", "patch", "confirm"]);
      if (input.confirm !== "UPDATE_FACEBOOK_PAGE")
        throw new Error("Page update confirmation required.");
      const { account } = await page(ctx, input.accountId, "profile.update");
      return writePage(
        ctx,
        account,
        "profile.update",
        input.patch,
        (current) => current.operations.updateProfile(current.account, current.token, input.patch),
        (result) => result.status === "partial" && result.failure.code === "unknown",
      );
    },
  },
  "facebook.page.uploadPhoto": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId", "kind", "uploadId", "confirm"]);
      if (input.confirm !== "UPLOAD_FACEBOOK_PAGE_PHOTO")
        throw new Error("Photo upload confirmation required.");
      const field =
        input.kind === "avatar"
          ? "avatarPhotoId"
          : input.kind === "cover"
            ? "coverPhotoId"
            : undefined;
      if (!field) throw new SocialPlatformError("rejected");
      const { account } = await page(ctx, input.accountId, "profile.update");
      const uploadId = str(input.uploadId, "media upload");
      const bytes = await ctx.service.readOwnerMedia(ctx.principal, uploadId);
      const digest = createHash("sha256").update(bytes).digest("hex");
      return writePage(
        ctx,
        account,
        "profile.update",
        { field, digest },
        (current) =>
          current.operations.uploadProfilePhoto(
            current.account,
            current.token,
            field,
            uploadId,
            bytes,
            async () => {
              const latest = await page(ctx, account.id, "profile.update");
              if (
                latest.account.platformId !== current.account.platformId ||
                latest.account.paused ||
                FACEBOOK_PAGE_PHOTO_SCOPES.some((scope) => !latest.account.scopes.includes(scope))
              )
                throw new SocialPlatformError("denied");
            },
          ),
        (result) => result.status === "partial" && result.failure.code === "unknown",
      );
    },
  },
  "facebook.post.edit": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId", "postId", "text", "confirm"]);
      if (input.confirm !== "EDIT_FACEBOOK_POST") throw new Error("Edit confirmation required.");
      return editFacebookPagePost(ctx, input);
    },
  },
  "facebook.post.delete": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId", "postId", "confirm"]);
      if (input.confirm !== "DELETE_FACEBOOK_POST")
        throw new Error("Deletion confirmation required.");
      const candidate = await ctx.service.access(
        ctx.principal,
        str(input.accountId, "account"),
        "read",
      );
      if (candidate.connection === "browser")
        return deleteBrowserPagePost(ctx, candidate, input.postId);
      const { account } = await page(ctx, input.accountId, "delete");
      const target = postId(account, input.postId);
      await writePage(ctx, account, "delete", target, async ({ adapter, token }) => {
        if (!adapter.deletePost) throw new SocialPlatformError("unsupported");
        await adapter.deletePost(account, token, target);
      });
      return { accountId: account.id, postId: target, deleted: true };
    },
  },
  "facebook.comment.moderate": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["threadId", "action", "confirm"]);
      if (input.confirm !== "MODERATE_FACEBOOK_COMMENT")
        throw new Error("Comment confirmation required.");
      return moderateFacebookPageComment(ctx, input);
    },
  },
  "facebook.privateReplyDraft": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["threadId", "text", "factIds"]);
      return ctx.service.createDraft(ctx.principal, "facebook.privateReplyDraft", input);
    },
  },
};
