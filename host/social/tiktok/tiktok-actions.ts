import { randomUUID } from "node:crypto";
import type {
  SocialAccount,
  SocialJob,
  SocialPermission,
} from "../../../src/features/social/model/social";
import { SocialHttp, SocialPlatformError } from "../../../src/integrations/social/adapter";
import {
  readTikTokDisplay,
  TikTokOrganic,
  type TikTokBusinessCredential,
} from "../../../src/integrations/social/adapters/tiktok-organic";
import { chargeAutonomy, revalidateAutonomy } from "../autonomy/autonomy-gate";
import { NeedsHumanQueue } from "../browser-layers/needs-human";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import type { PlatformBrowserSessions } from "../social-browser-platforms";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import type { SocialCredentialStore } from "../social-credentials";
import { tiktokManageComment, tiktokStudioComments } from "./browser-comments";
import { tiktokMessages } from "./browser-dm";
import { tiktokMentions } from "./browser-mentions";
import {
  readTikTokProfile,
  parseTikTokPrivacyPatch,
  parseTikTokProfilePatch,
  readTikTokPrivacy,
  updateTikTokProfile,
  updateTikTokPrivacy,
} from "./browser-profile";
import { listTikTokRelationships, setTikTokFollowing } from "./browser-audience";
import { readTikTokAnalytics, readTikTokEarnings } from "./browser-insights";
import { replyTikTokLive, saveTikTokLiveSetup } from "./browser-live";
import { tiktokDeletePost, tiktokEditPost } from "./browser-publish-ext";
import { tiktokOrganicInbound } from "./tiktok-organic-inbox";

export type TikTokRuntime = {
  runBrowser?: PlatformBrowserSessions["runTikTok"];
  executorId: string;
  secrets: Pick<SocialCredentialStore, "get">;
  storeSecret(account: SocialAccount, id: string, value: string): Promise<void>;
  avatar(id: string): Promise<Uint8Array>;
  rename(account: SocialAccount, profile: { platformId: string; name: string }): Promise<void>;
};

function id(value: unknown, pattern = /^[\w:.@-]{1,300}$/): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new SocialPlatformError("rejected");
  return value;
}

function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new SocialPlatformError("rejected");
  return value.trim();
}

function patch(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new SocialPlatformError("rejected");
  return input as Record<string, unknown>;
}

async function getAccount(
  ctx: SocialActionContext,
  accountId: unknown,
  permission: SocialPermission = "read",
) {
  const runtime = ctx.tiktok;
  if (!runtime) throw new SocialPlatformError("unsupported");
  const account = await ctx.service.access(ctx.principal, id(accountId), permission);
  if (
    account.platform !== "tiktok" ||
    !account.connected ||
    !account.accessApproved ||
    account.paused ||
    account.executorId !== runtime.executorId
  )
    throw new SocialPlatformError("denied");
  return account;
}

async function browser<T>(
  ctx: SocialActionContext,
  account: SocialAccount,
  operation: (browserContext: BrowserRecipeContext) => Promise<T>,
  options: {
    permission?: SocialPermission;
    beforeSubmit?: () => Promise<void>;
    secret?: boolean;
    avatar?: Uint8Array;
  } = {},
) {
  const execute = ctx.tiktok?.runBrowser;
  if (!execute) throw new SocialPlatformError("unsupported");
  const check = async () => {
    const latest = await getAccount(ctx, account.id, options.permission);
    if (
      latest.platformId !== account.platformId ||
      latest.connection !== account.connection ||
      latest.accountType !== account.accountType
    )
      throw new SocialPlatformError("denied");
  };
  try {
    return await execute(account, operation, { ...options, check });
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "needs_human") {
      await new NeedsHumanQueue(ctx.store, ctx.now).open({
        accountId: account.id,
        kind: "unexpected",
        url: "https://www.tiktok.com/",
      });
    }
    throw error;
  }
}

function read(
  operation: (
    ctx: SocialActionContext,
    account: SocialAccount,
    input: Record<string, unknown>,
  ) => Promise<unknown>,
  ownerOnly = false,
) {
  return {
    readOnly: true,
    ownerOnly,
    tool: !ownerOnly,
    run: async (ctx: SocialActionContext, input: Record<string, unknown>) =>
      await operation(ctx, await getAccount(ctx, input.accountId), input),
  };
}

async function ownerEditAllowed(ctx: SocialActionContext, confirm: unknown) {
  ctx.service.owner(ctx.principal);
  if (confirm !== true || (await ctx.service.setting("stopped")) === "true")
    throw new SocialPlatformError("denied");
}

async function unknownReceipt<T>(result: Promise<T>) {
  return await result.catch((error: unknown) => {
    if (error instanceof SocialPlatformError && error.code === "unknown")
      return { status: "unknown" as const };
    throw error;
  });
}

async function display(ctx: SocialActionContext, account: SocialAccount) {
  ctx.service.capability(account, "profile.read");
  const credential = await ctx.service.credentialFor(account.id);
  if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
    throw new SocialPlatformError("expired");
  const result = await readTikTokDisplay(
    new SocialHttp(),
    credential.accessToken,
    account.platformId,
    account.scopes,
  );
  const latest = await getAccount(ctx, account.id);
  if (latest.platformId !== account.platformId || latest.connection !== account.connection)
    throw new SocialPlatformError("denied");
  return result;
}

const postIdentifier = /^\d{1,30}$/;
const recipientIdentifier = /^web:tiktok:[a-z0-9_.]{2,24}$/;
const changeKinds = [
  "follow",
  "unfollow",
  "comment.like",
  "comment.hide",
  "comment.delete",
  "comment.pin",
  "comment.reply",
  "post.edit",
  "post.delete",
  "profile.update",
  "privacy.update",
  "live.reply",
] as const;
type ChangeKind = (typeof changeKinds)[number];
const ownerChanges = new Set<ChangeKind>([
  "comment.delete",
  "post.edit",
  "post.delete",
  "profile.update",
  "privacy.update",
]);
/** Owner-executed kinds an AI session may still queue for review. They never dispatch without the owner. */
const aiQueuedChanges = new Set<ChangeKind>(["post.delete", "profile.update", "privacy.update"]);
type Change = {
  kind: ChangeKind;
  postId?: string;
  commentId?: string;
  recipientId?: string;
  text?: string;
  mediaType?: "video" | "photo";
  patch?: Record<string, unknown>;
};
type Review = {
  id: string;
  accountId: string;
  projectId?: string;
  platformId: string;
  change: Change;
  at: number;
  startedAt?: number;
  state: "pending" | "submitting" | "done" | "unknown";
};
export const tiktokLiveSecretId = (accountId: string) => `tiktok.live:${accountId}`;
export const tiktokBusinessSecretId = (accountId: string) => `tiktok.business:${accountId}`;
const REVIEW_TTL = 30 * 60_000;

function businessApproved() {
  return process.env.BYCODA_SOCIAL_TIKTOK_BUSINESS_APPROVED === "true";
}

export async function boundTikTokBusiness(
  account: SocialAccount,
  secrets: Pick<SocialCredentialStore, "get"> | undefined,
) {
  if (!businessApproved()) return undefined;
  const raw = await secrets?.get(tiktokBusinessSecretId(account.id));
  if (!raw) return undefined;
  const credential = JSON.parse(raw.accessToken) as TikTokBusinessCredential;
  const api = new TikTokOrganic(true);
  await assertBusinessIdentity(account, api, credential);
  return { api, credential };
}

const business = (ctx: SocialActionContext, account: SocialAccount) =>
  boundTikTokBusiness(account, ctx.tiktok?.secrets);

async function assertBusinessIdentity(
  account: SocialAccount,
  api: TikTokOrganic,
  credential: TikTokBusinessCredential,
) {
  const profile = await api.profile(credential);
  if (account.platformId !== `web:tiktok:${profile.username.toLowerCase()}`)
    throw new SocialPlatformError("denied");
}

function parseChange(input: Record<string, unknown>): Change {
  const kind = changeKinds.find((candidate) => candidate === input.kind);
  if (!kind) throw new SocialPlatformError("rejected");
  if (kind === "follow" || kind === "unfollow")
    return { kind, recipientId: id(input.recipientId, recipientIdentifier) };
  if (kind === "profile.update")
    return { kind, patch: { ...parseTikTokProfilePatch(patch(input.patch)) } };
  if (kind === "privacy.update")
    return { kind, patch: { ...parseTikTokPrivacyPatch(patch(input.patch)) } };
  if (kind === "live.reply")
    return {
      kind,
      recipientId: id(input.recipientId, recipientIdentifier),
      commentId: id(input.commentId),
      text: text(input.text, 150),
    };
  const postId = id(input.postId, postIdentifier);
  if (kind === "post.edit" || kind === "post.delete") {
    const mediaType = input.mediaType;
    if (mediaType !== undefined && mediaType !== "video" && mediaType !== "photo")
      throw new SocialPlatformError("rejected");
    return {
      kind,
      postId,
      mediaType,
      ...(kind === "post.edit" ? { text: text(input.text, 2200) } : {}),
    };
  }
  return {
    kind,
    postId,
    commentId: id(input.commentId),
    recipientId: id(input.recipientId, recipientIdentifier),
    ...(kind === "comment.reply" ? { text: text(input.text, 150) } : {}),
  };
}

function actionKind(change: Change): SocialJob["kind"] {
  if (change.kind.startsWith("post.") || change.patch) return "publish";
  return change.kind === "live.reply" || change.kind === "comment.reply" ? "reply" : "comment";
}

const reviewWrites = new WeakMap<SocialActionContext["store"], Promise<unknown>>();

async function listReviews(ctx: SocialActionContext, accountId: string): Promise<Review[]> {
  const rows = JSON.parse(
    (await ctx.store.getSetting(`tiktok.reviews:${accountId}`)) ?? "[]",
  ) as Review[];
  return rows.filter(
    (row) =>
      row.state === "submitting" || row.state === "unknown" || ctx.now() - row.at < REVIEW_TTL,
  );
}

async function updateReviews<T>(
  ctx: SocialActionContext,
  accountId: string,
  update: (rows: Review[]) => T,
) {
  const current = (reviewWrites.get(ctx.store) ?? Promise.resolve()).then(async () => {
    const rows = await listReviews(ctx, accountId);
    const result = update(rows);
    await ctx.store.putSetting(`tiktok.reviews:${accountId}`, JSON.stringify(rows));
    return result;
  });
  reviewWrites.set(
    ctx.store,
    current.catch(() => undefined),
  );
  return await current;
}

async function applyChange(
  ctx: SocialActionContext,
  account: SocialAccount,
  review: Review,
  ownerApproved: boolean,
) {
  const change = review.change;
  // Defense in depth: the apply action is owner-only, and owner-executed kinds never run on autonomy.
  if (ownerChanges.has(change.kind) && !ownerApproved) throw new SocialPlatformError("denied");
  if (change.kind === "profile.update" || change.kind === "privacy.update") {
    if (!ownerApproved) throw new SocialPlatformError("denied");
    const beforeSubmit = () => ownerEditAllowed(ctx, true);
    await beforeSubmit();
    const fields = change.patch ?? {};
    return change.kind === "profile.update"
      ? await updateProfile(ctx, account, fields, beforeSubmit)
      : await updatePrivacy(ctx, account, fields, beforeSubmit);
  }
  const kind = actionKind(change);
  const authority = { accountId: account.id, action: kind, principal: ctx.principal };
  const decision = await ctx.service.authorizeAutonomous(authority);
  if (!ownerApproved && (decision.mode !== "autonomous" || decision.scheduledAt > ctx.now()))
    throw new SocialPlatformError("denied");
  const autonomyJob = {
    kind,
    approval: decision.mode === "autonomous" ? decision.approval : undefined,
  };
  const deps = {
    audience: ctx.store,
    now: ctx.now,
    setting: (key: string) => ctx.service.setting(key),
  };
  let committing = false;
  const beforeSubmit = async () => {
    if ((await deps.setting("stopped")) === "true" || (await deps.setting("sending")) !== "true")
      throw new SocialPlatformError("denied");
    const latest = await getAccount(ctx, account.id, kind);
    if (latest.platformId !== account.platformId || latest.connection !== account.connection)
      throw new SocialPlatformError("denied");
    if (change.recipientId) {
      const person = await ctx.store.findPersonByHandle(account.id, change.recipientId);
      await ctx.service.assertSendable(
        {
          platform: "tiktok",
          platformId: change.recipientId,
          personId: person?.id,
        },
        "comment",
      );
    }
    if (!committing && ctx.now() - review.at >= REVIEW_TTL) throw new SocialPlatformError("denied");
    await revalidateAutonomy(deps, autonomyJob as SocialJob);
    if (!committing) {
      await chargeAutonomy(deps, autonomyJob as SocialJob);
      committing = true;
    }
  };
  const execute = async () => {
    if (change.kind.startsWith("comment.") && change.kind !== "comment.pin") {
      const organic = await business(ctx, account);
      if (organic) {
        const { api, credential } = organic;
        const action = change.kind.split(".")[1] as "like" | "hide" | "delete" | "reply";
        return await api.mutateComment(
          credential,
          {
            postId: change.postId!,
            commentId: change.commentId!,
            action,
            text: change.text,
          },
          async (comment) => {
            if (!comment.username || `web:tiktok:${comment.username}` !== change.recipientId)
              throw new SocialPlatformError("denied");
            await beforeSubmit();
          },
        );
      }
      if (change.kind === "comment.reply") throw new SocialPlatformError("unsupported");
    }
    return await browser(
      ctx,
      account,
      async (page) => {
        const submit = page.beforeSubmit!;
        switch (change.kind) {
          case "follow":
          case "unfollow":
            return setTikTokFollowing(page, change.recipientId!, change.kind === "follow", submit);
          case "live.reply":
            return replyTikTokLive(
              page,
              {
                recipientId: change.recipientId!,
                commentId: change.commentId!,
                text: change.text!,
              },
              submit,
            );
          case "post.edit":
            return tiktokEditPost(
              page,
              { postId: change.postId!, caption: change.text!, mediaType: change.mediaType },
              submit,
            );
          case "post.delete":
            return tiktokDeletePost(
              page,
              { postId: change.postId!, mediaType: change.mediaType },
              submit,
            );
          default:
            return tiktokManageComment(
              page,
              {
                postId: change.postId!,
                commentId: change.commentId!,
                contactId: change.recipientId!,
                action: change.kind.split(".")[1] as "like" | "hide" | "delete" | "pin",
              },
              submit,
            );
        }
      },
      { permission: kind, beforeSubmit, secret: change.kind === "live.reply" },
    );
  };
  const result = await execute().catch((error: unknown) => {
    if (error instanceof SocialPlatformError && error.code === "unknown" && committing)
      return { status: "unknown" as const };
    throw error;
  });
  return result;
}

export const tiktokActions: SocialActionModule = {
  "tiktok.profile.read": read((ctx, account) =>
    account.connection === "browser"
      ? browser(ctx, account, readTikTokProfile)
      : display(ctx, account),
  ),
  "tiktok.analytics.read": read(async (ctx, account) => {
    const organic = await business(ctx, account);
    if (organic) {
      const data = await organic.api.profile(organic.credential, { stats: true });
      const posts = await organic.api.videos(organic.credential);
      await getAccount(ctx, account.id);
      return { source: "business", ...data, ...posts };
    }
    if (account.connection === "browser") return browser(ctx, account, readTikTokAnalytics);
    ctx.service.capability(account, "analytics");
    const credential = await ctx.service.credentialFor(account.id);
    const adapter = ctx.service.adapterFor(account);
    if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
      throw new SocialPlatformError("expired");
    const posts = (await adapter.listPosts!(account, credential.accessToken)).posts;
    const metrics = posts.length
      ? await adapter.getAnalytics!(
          account,
          credential.accessToken,
          posts.map(({ id }) => id),
        )
      : {};
    const latest = await getAccount(ctx, account.id);
    if (latest.platformId !== account.platformId || latest.connection !== account.connection)
      throw new SocialPlatformError("denied");
    return { source: "display", posts, metrics };
  }),
  "tiktok.earnings.read": read((ctx, account) => browser(ctx, account, readTikTokEarnings)),
  "tiktok.privacy.read": read((ctx, account) => browser(ctx, account, readTikTokPrivacy), true),
  "tiktok.audience.list": read((ctx, account, input) => {
    const kind = input.kind;
    if (kind !== "followers" && kind !== "following") throw new SocialPlatformError("rejected");
    return browser(ctx, account, (page) => listTikTokRelationships(page, kind));
  }),
  "tiktok.comments.list": read(async (ctx, account, input) => {
    const organic = await business(ctx, account);
    if (organic) {
      const result = await organic.api.comments(
        organic.credential,
        id(input.postId, postIdentifier),
      );
      await getAccount(ctx, account.id);
      return result;
    }
    return browser(ctx, account, tiktokStudioComments);
  }, true),
  "tiktok.comments.sync": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      const account = await getAccount(ctx, input.accountId);
      const organic = await business(ctx, account);
      const events = organic
        ? tiktokOrganicInbound(
            (await organic.api.comments(organic.credential, id(input.postId, postIdentifier)))
              .comments,
          )
        : (await browser(ctx, account, tiktokStudioComments)).events;
      const latest = await getAccount(ctx, account.id);
      if (latest.platformId !== account.platformId || latest.connection !== account.connection)
        throw new SocialPlatformError("denied");
      return { ingested: await ctx.service.ingest(account.id, events) };
    },
  },
  "tiktok.mentions.list": read(async (ctx, account) => {
    const organic = await business(ctx, account);
    if (organic) {
      const result = await organic.api.mentions(organic.credential);
      await getAccount(ctx, account.id);
      return result;
    }
    return browser(ctx, account, tiktokMentions);
  }),
  "tiktok.business.status": read(
    async (ctx, account) => ({
      approved: businessApproved(),
      connected:
        businessApproved() && !!(await ctx.tiktok?.secrets.get(tiktokBusinessSecretId(account.id))),
    }),
    true,
  ),
  "tiktok.business.connect": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      if (!businessApproved()) throw new SocialPlatformError("unsupported");
      const account = await getAccount(ctx, input.accountId);
      if (account.connection !== "browser" || input.confirm !== true)
        throw new SocialPlatformError("denied");
      const credential = {
        businessId: id(input.businessId, /^[\w-]{1,300}$/),
        accessToken: id(input.accessToken, /^[!-~]{1,4096}$/),
      };
      await assertBusinessIdentity(account, new TikTokOrganic(true), credential);
      await ctx.tiktok!.storeSecret(
        account,
        tiktokBusinessSecretId(account.id),
        JSON.stringify(credential),
      );
      return { connected: true };
    },
  },
  "tiktok.messages.list": read((ctx, account) => browser(ctx, account, tiktokMessages), true),
  "tiktok.messages.sync": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      const account = await getAccount(ctx, input.accountId);
      const { events } = await browser(ctx, account, tiktokMessages);
      return { ingested: await ctx.service.ingest(account.id, events) };
    },
  },
  "tiktok.live.setup": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      const account = await getAccount(ctx, input.accountId);
      return browser(
        ctx,
        account,
        (page) =>
          saveTikTokLiveSetup(page, async (credential) => {
            const latest = await getAccount(ctx, account.id);
            if (
              latest.platformId !== account.platformId ||
              latest.connection !== account.connection
            )
              throw new SocialPlatformError("denied");
            await ctx.tiktok!.storeSecret(
              account,
              tiktokLiveSecretId(account.id),
              JSON.stringify(credential),
            );
          }),
        { secret: true },
      );
    },
  },
  "tiktok.profile.update": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      const account = await getAccount(ctx, input.accountId);
      const beforeSubmit = () => ownerEditAllowed(ctx, input.confirm);
      await beforeSubmit();
      return await updateProfile(ctx, account, patch(input.patch), beforeSubmit);
    },
  },
  "tiktok.privacy.update": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      const account = await getAccount(ctx, input.accountId);
      const beforeSubmit = () => ownerEditAllowed(ctx, input.confirm);
      await beforeSubmit();
      return await updatePrivacy(ctx, account, patch(input.patch), beforeSubmit);
    },
  },
  "tiktok.changes.list": read((ctx, account) => listReviews(ctx, account.id), true),
  "tiktok.changes.request": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      const change = parseChange(input);
      const account = await getAccount(
        ctx,
        input.accountId,
        change.patch ? "draft" : actionKind(change),
      );
      if (account.connection !== "browser") throw new SocialPlatformError("unsupported");
      const aiQueued = ownerChanges.has(change.kind) && ctx.principal.kind !== "owner";
      if (aiQueued && !aiQueuedChanges.has(change.kind)) throw new SocialPlatformError("denied");
      if (aiQueued && (await ctx.service.setting("ai.stopped")) === "true")
        throw new SocialPlatformError("denied");
      if (change.kind === "comment.reply" && !(await business(ctx, account)))
        throw new SocialPlatformError("unsupported");
      const decision = await ctx.service.authorizeAutonomous({
        accountId: account.id,
        action: actionKind(change),
        principal: ctx.principal,
      });
      const item = await updateReviews(ctx, account.id, (rows) => {
        const existing = rows.find(
          (row) =>
            row.state !== "done" &&
            row.platformId === account.platformId &&
            JSON.stringify(row.change) === JSON.stringify(change),
        );
        if (existing?.state === "unknown" || existing?.state === "submitting")
          throw new SocialPlatformError("unknown");
        if (existing) {
          if (ctx.principal.kind !== "owner" && existing.projectId !== ctx.principal.projectId)
            throw new SocialPlatformError("denied");
          return existing;
        }
        if (rows.length >= 30) {
          const completed = rows.findIndex((row) => row.state === "done");
          if (completed < 0) throw new SocialPlatformError("rejected");
          rows.splice(completed, 1);
        }
        const item: Review = {
          id: randomUUID(),
          accountId: account.id,
          projectId: ctx.principal.projectId,
          change,
          platformId: account.platformId,
          state: "pending",
          at: ctx.now(),
        };
        rows.push(item);
        return item;
      });
      return !ownerChanges.has(change.kind) &&
        decision.mode === "autonomous" &&
        decision.scheduledAt <= ctx.now()
        ? await dispatchReview(ctx, account, item.id, false)
        : item;
    },
  },
  "tiktok.changes.apply": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      const account = await getAccount(ctx, input.accountId);
      const reviewId = id(input.reviewId);
      if (input.confirm !== true) throw new SocialPlatformError("denied");
      return await dispatchReview(ctx, account, reviewId, true);
    },
  },
  "tiktok.changes.dismiss": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      const account = await getAccount(ctx, input.accountId);
      const reviewId = id(input.reviewId);
      if (input.confirm !== true) throw new SocialPlatformError("denied");
      return await updateReviews(ctx, account.id, (rows) => {
        const index = rows.findIndex((row) => row.id === reviewId);
        if (
          index < 0 ||
          (rows[index].state === "submitting" &&
            ctx.now() - (rows[index].startedAt ?? rows[index].at) < REVIEW_TTL)
        )
          throw new SocialPlatformError("denied");
        rows.splice(index, 1);
        return { dismissed: true };
      });
    },
  },
};

async function updateProfile(
  ctx: SocialActionContext,
  account: SocialAccount,
  fields: Record<string, unknown>,
  beforeSubmit: () => Promise<void>,
) {
  if (
    typeof fields.username === "string" &&
    (await ctx.service.accounts(ctx.principal)).some(
      (other) =>
        other.id !== account.id &&
        other.platform === "tiktok" &&
        other.platformId === `web:tiktok:${fields.username}`,
    )
  )
    throw new SocialPlatformError("denied");
  const avatar =
    fields.avatarUploadId === undefined
      ? undefined
      : await ctx.tiktok!.avatar(id(fields.avatarUploadId));
  const result = await unknownReceipt(
    browser(ctx, account, (page) => updateTikTokProfile(page, fields), {
      avatar,
      beforeSubmit,
    }),
  );
  if ("status" in result) return result;
  if (result.platformId !== account.platformId) {
    try {
      await ctx.tiktok!.rename(account, result);
    } catch {
      return { status: "unknown" };
    }
  }
  return result;
}

async function updatePrivacy(
  ctx: SocialActionContext,
  account: SocialAccount,
  fields: Record<string, unknown>,
  beforeSubmit: () => Promise<void>,
) {
  return unknownReceipt(
    browser(ctx, account, (page) => updateTikTokPrivacy(page, fields), { beforeSubmit }),
  );
}

async function dispatchReview(
  ctx: SocialActionContext,
  account: SocialAccount,
  reviewId: string,
  ownerApproved: boolean,
) {
  const review = await updateReviews(ctx, account.id, (rows) => {
    const item = rows.find((row) => row.id === reviewId);
    if (
      !item ||
      item.state !== "pending" ||
      item.platformId !== account.platformId ||
      ctx.now() - item.at >= REVIEW_TTL
    )
      throw new SocialPlatformError("denied");
    item.state = "submitting";
    item.startedAt = ctx.now();
    return item;
  });
  const saveState = (state: Review["state"]) =>
    updateReviews(ctx, account.id, (rows) => {
      const item = rows.find((row) => row.id === reviewId);
      if (item) item.state = state;
    });
  const result = await applyChange(ctx, account, review, ownerApproved).catch(
    async (error: unknown) => {
      await saveState("pending");
      throw error;
    },
  );
  const state = "status" in result && result.status === "unknown" ? "unknown" : "done";
  await saveState(state);
  return { ...result, accountId: account.id, projectId: review.projectId };
}
