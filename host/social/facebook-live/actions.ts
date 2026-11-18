import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp, SocialPlatformError } from "../../../src/integrations/social/adapter";
import {
  facebookLiveApi,
  facebookLiveCommentId,
  facebookLiveId,
} from "../../../src/integrations/social/adapters/facebook-live";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import {
  liveSecretKey,
  readLiveReceipt,
  writeLiveReceipt,
  type FacebookLivePhase,
  type FacebookLiveReceipt,
} from "./receipts";

const LIVE_SCOPES = ["pages_manage_posts", "publish_video"];
const COMMENT_SCOPES = ["pages_read_engagement", "pages_read_user_content"];
const locks = new WeakMap<SocialActionContext["service"], Map<string, Promise<unknown>>>();

async function locked<T>(ctx: SocialActionContext, accountId: string, run: () => Promise<T>) {
  let byAccount = locks.get(ctx.service);
  if (!byAccount) {
    byAccount = new Map();
    locks.set(ctx.service, byAccount);
  }
  const pending = (byAccount.get(accountId) ?? Promise.resolve()).catch(() => undefined).then(run);
  byAccount.set(accountId, pending);
  try {
    return await pending;
  } finally {
    if (byAccount.get(accountId) === pending) byAccount.delete(accountId);
  }
}

export function assertLivePage(account: SocialAccount, environmentId: string) {
  if (
    account.platform !== "facebook" ||
    account.accountType !== "page" ||
    account.connection === "browser"
  )
    throw new SocialPlatformError("unsupported");
  if (!account.connected || !account.accessApproved || account.executorId !== environmentId)
    throw new SocialPlatformError("denied");
  facebookLiveId(account.platformId);
}

async function livePage(
  ctx: SocialActionContext,
  accountId: string,
  permissions: { grant?: "read" | "draft" | "publish"; scopes?: string[] } = {},
) {
  if (!ctx.facebookLive) throw new SocialPlatformError("unsupported");
  const account = await ctx.service.access(ctx.principal, accountId, permissions.grant ?? "read");
  assertLivePage(account, ctx.facebookLive.environmentId);
  if (permissions.scopes?.some((scope) => !account.scopes.includes(scope)))
    throw new SocialPlatformError("denied", undefined, { reasonCode: "platform.scope_missing" });
  return account;
}

async function token(ctx: SocialActionContext, accountId: string) {
  const credential = await ctx.service.credentialFor(accountId);
  if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
    throw new SocialPlatformError("expired");
  return credential.accessToken;
}

async function receiptFor(ctx: SocialActionContext, account: SocialAccount, liveId: string) {
  const receipt = await readLiveReceipt(ctx.service, account.id, account.platformId);
  if (receipt?.id !== liveId) throw new SocialPlatformError("denied");
  return receipt;
}

function view(receipt: FacebookLiveReceipt) {
  const { accountId, id, title, phase, createdAt, encoderReady } = receipt;
  return { accountId, id, title, phase, createdAt, encoderReady };
}

function requireOwnerConfirmation(ctx: SocialActionContext, actual: unknown, expected: string) {
  ctx.service.owner(ctx.principal);
  if (actual !== expected) throw new Error(`Explicit confirmation ${expected} required.`);
}

async function assertStartAllowed(ctx: SocialActionContext, account: SocialAccount) {
  if (
    account.paused ||
    (await ctx.service.setting("stopped")) === "true" ||
    (await ctx.service.setting("sending")) !== "true"
  )
    throw new Error("Enable Social sending before starting a Facebook Live broadcast.");
  await ctx.service.assertSendable(
    { platform: "facebook", platformId: account.platformId },
    "comment",
  );
}

function definitive(error: unknown): boolean {
  return (
    error instanceof SocialPlatformError &&
    ["rejected", "denied", "expired", "rate_limit"].includes(error.code)
  );
}

export function createFacebookLiveOperations(api: () => ReturnType<typeof facebookLiveApi>) {
  const transition =
    (change: "start" | "end") =>
    async (
      ctx: SocialActionContext,
      input: Record<string, unknown>,
      beforeWrite?: () => Promise<void>,
    ) => {
      exact(input, ["accountId", "liveId", "confirm"]);
      if (!beforeWrite)
        requireOwnerConfirmation(
          ctx,
          input.confirm,
          change === "start" ? "START_FACEBOOK_LIVE" : "END_FACEBOOK_LIVE",
        );
      const accountId = str(input.accountId, "account");
      const liveId = facebookLiveId(input.liveId);
      return await locked(ctx, accountId, async () => {
        const account = await livePage(ctx, accountId, { grant: "publish", scopes: LIVE_SCOPES });
        const current = await receiptFor(ctx, account, liveId);
        const target = change === "start" ? "live" : "ended";
        if (current.phase === target) return view(current);
        if (current.phase === "ended") throw new SocialPlatformError("rejected");
        const credentials = ctx.facebookLive!.credentials;
        const provider = api();
        const accessToken = await token(ctx, accountId);
        const remote = await provider.status(liveId, accessToken, account.platformId);
        async function finish() {
          const receipt: FacebookLiveReceipt = {
            ...current,
            phase: target,
            encoderReady: target === "live" && current.encoderReady,
          };
          if (target === "ended") {
            await writeLiveReceipt(ctx.service, accountId, {
              ...current,
              phase: "ending",
              encoderReady: false,
            });
            await credentials.delete(liveSecretKey(accountId, liveId));
          }
          await writeLiveReceipt(ctx.service, accountId, receipt);
          return view(receipt);
        }
        if (remote === target) return await finish();
        if (current.phase === "ending" || (current.phase === "starting" && change === "start"))
          throw new SocialPlatformError("unknown");
        if (
          change === "start" &&
          (current.phase !== "unpublished" || remote !== "unpublished" || !current.encoderReady)
        )
          throw new SocialPlatformError("rejected");
        if (change === "end" && remote !== "unpublished" && remote !== "live")
          throw new SocialPlatformError("rejected");
        const pending: FacebookLivePhase = change === "start" ? "starting" : "ending";
        if (change === "start") await assertStartAllowed(ctx, account);
        const latest = await livePage(ctx, accountId, { grant: "publish", scopes: LIVE_SCOPES });
        if (latest.platformId !== account.platformId) throw new SocialPlatformError("denied");
        await writeLiveReceipt(ctx.service, accountId, { ...current, phase: pending });
        try {
          if (change === "start") await assertStartAllowed(ctx, latest);
          await beforeWrite?.();
        } catch (error) {
          await writeLiveReceipt(ctx.service, accountId, current);
          throw error;
        }
        try {
          await provider.update(liveId, accessToken, change);
        } catch (error) {
          if (definitive(error)) await writeLiveReceipt(ctx.service, accountId, current);
          throw error;
        }
        return await finish();
      });
    };

  const create = async (
    ctx: SocialActionContext,
    input: Record<string, unknown>,
    beforeWrite?: () => Promise<void>,
  ) => {
    exact(input, ["accountId", "title", "description", "confirm"]);
    if (!beforeWrite) requireOwnerConfirmation(ctx, input.confirm, "CREATE_FACEBOOK_LIVE");
    const accountId = str(input.accountId, "account");
    const title = str(input.title, "title", 254);
    const description =
      input.description === undefined ? undefined : str(input.description, "description", 8000);
    return await locked(ctx, accountId, async () => {
      const account = await livePage(ctx, accountId, { grant: "publish", scopes: LIVE_SCOPES });
      const current = await readLiveReceipt(ctx.service, accountId, account.platformId);
      if (current && current.phase !== "ended") return view(current);
      const accessToken = await token(ctx, accountId);
      const provider = api();
      const latest = await livePage(ctx, accountId, { grant: "publish", scopes: LIVE_SCOPES });
      if (latest.platformId !== account.platformId) throw new SocialPlatformError("denied");
      const receipt: FacebookLiveReceipt = {
        accountId,
        pageId: account.platformId,
        title,
        phase: "creating",
        createdAt: ctx.now(),
        encoderReady: false,
      };
      await writeLiveReceipt(ctx.service, accountId, receipt);
      try {
        await beforeWrite?.();
      } catch (error) {
        await writeLiveReceipt(ctx.service, accountId, current);
        throw error;
      }
      let created: Awaited<ReturnType<ReturnType<typeof facebookLiveApi>["create"]>>;
      try {
        created = await provider.create(account.platformId, accessToken, title, description);
      } catch (error) {
        if (definitive(error)) await writeLiveReceipt(ctx.service, accountId, current);
        throw error;
      }
      const accepted: FacebookLiveReceipt = {
        ...receipt,
        id: created.id,
        phase: "unpublished",
      };
      await writeLiveReceipt(ctx.service, accountId, accepted);
      if (!created.encoderUrl) return view(accepted);
      await ctx.facebookLive!.credentials.set(liveSecretKey(accountId, created.id), {
        accessToken: created.encoderUrl,
      });
      const ready = { ...accepted, encoderReady: true };
      await writeLiveReceipt(ctx.service, accountId, ready);
      return view(ready);
    });
  };
  return { create, transition };
}

export function createFacebookLiveActions(
  api: () => ReturnType<typeof facebookLiveApi>,
): SocialActionModule {
  const { create, transition } = createFacebookLiveOperations(api);
  return {
    "facebook.live.create": {
      readOnly: false,
      ownerOnly: true,
      run: create,
    },
    "facebook.live.list": {
      readOnly: true,
      ownerOnly: false,
      tool: true,
      run: async (ctx, input) => {
        exact(input, ["accountId"]);
        const account = await livePage(ctx, str(input.accountId, "account"));
        const receipt = await readLiveReceipt(ctx.service, account.id, account.platformId);
        return { broadcasts: receipt ? [view(receipt)] : [] };
      },
    },
    "facebook.live.start": { readOnly: false, ownerOnly: true, run: transition("start") },
    "facebook.live.end": { readOnly: false, ownerOnly: true, run: transition("end") },
    "facebook.live.comments": {
      readOnly: true,
      ownerOnly: false,
      tool: true,
      run: async (ctx, input) => {
        exact(input, ["accountId", "liveId", "cursor"]);
        const account = await livePage(ctx, str(input.accountId, "account"), {
          scopes: COMMENT_SCOPES,
        });
        const liveId = facebookLiveId(input.liveId);
        await receiptFor(ctx, account, liveId);
        const cursor = input.cursor === undefined ? undefined : str(input.cursor, "cursor", 1024);
        return await api().comments(liveId, await token(ctx, account.id), cursor);
      },
    },
    "facebook.live.replyDraft": {
      readOnly: false,
      ownerOnly: false,
      tool: true,
      run: async (ctx, input) => {
        exact(input, ["accountId", "liveId", "commentId", "cursor", "text"]);
        const account = await livePage(ctx, str(input.accountId, "account"), {
          grant: "draft",
          scopes: [...COMMENT_SCOPES, "pages_manage_engagement"],
        });
        await ctx.service.access(ctx.principal, account.id, "read");
        const liveId = facebookLiveId(input.liveId);
        const commentId = facebookLiveCommentId(input.commentId);
        const text = str(input.text, "reply", 8000);
        const cursor = input.cursor === undefined ? undefined : str(input.cursor, "cursor", 1024);
        await receiptFor(ctx, account, liveId);
        const page = await api().comments(liveId, await token(ctx, account.id), cursor);
        const comment = page.comments.find((entry) => entry.id === commentId);
        if (
          !comment?.canReply ||
          !comment.authorId ||
          !comment.at ||
          comment.authorId === account.platformId
        )
          throw new SocialPlatformError("denied");
        const latest = await livePage(ctx, account.id, {
          grant: "draft",
          scopes: [...COMMENT_SCOPES, "pages_manage_engagement"],
        });
        if (latest.platformId !== account.platformId) throw new SocialPlatformError("denied");
        await ctx.service.ingest(
          account.id,
          [
            {
              kind: "comment",
              eventId: comment.id,
              threadId: comment.id,
              postId: liveId,
              contactId: comment.authorId,
              contactName: comment.authorName ?? comment.authorId,
              text: comment.text,
              at: comment.at,
              replyAllowed: true,
            },
          ],
          { draftOnly: true },
        );
        return await ctx.service.createDraft(ctx.principal, "replies.draft", {
          accountId: account.id,
          threadId: `${account.id}:comment:${comment.id}`,
          text,
        });
      },
    },
  };
}

const defaultApi = () =>
  facebookLiveApi(new SocialHttp(), process.env.BYCODA_SOCIAL_GRAPH_VERSION ?? "v25.0");
export const facebookLiveActions = createFacebookLiveActions(defaultApi);
export const facebookLiveOperations = createFacebookLiveOperations(defaultApi);
