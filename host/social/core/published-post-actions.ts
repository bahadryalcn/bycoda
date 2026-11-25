import type {
  SocialAccount,
  SocialJob,
  SocialWorkspaceResponse,
} from "../../../src/features/social/model/social";
import type {
  PublishedPostDeletion,
  PublishedPosts,
} from "../../../src/features/social/model/publishedPosts";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { parseTelegramPlatformId } from "../../../src/integrations/social/adapters/telegram-api";
import { exact, hash, str } from "./social-helpers";
import type { SocialActionContext, SocialActionModule } from "./social-actions";

const postPattern = /^t3_[a-z0-9]{1,30}$/;
const active = new WeakMap<SocialActionContext["service"], Set<string>>();
type Platform = "reddit" | "telegram";

async function accountFor(ctx: SocialActionContext, id: unknown, platform: Platform) {
  const account = await ctx.service.access(ctx.principal, str(id, "account"), "read");
  if (
    account.platform !== platform ||
    (platform === "reddit"
      ? account.accountType !== "member"
      : account.accountType !== "channel" || account.connection !== "token")
  )
    throw new SocialPlatformError("unsupported");
  return account;
}

const receiptKey = (account: SocialAccount, postId: string) =>
  `${account.platform}.delete:${hash(JSON.stringify([account.platformId.replace(/^web:reddit:/, ""), postId]))}`;

async function receipt(
  ctx: SocialActionContext,
  key: string,
): Promise<PublishedPostDeletion | undefined> {
  const state = await ctx.service.setting(key);
  return state === "review" || state === "deleted" ? state : undefined;
}

function publishedTarget(job: SocialJob, account: SocialAccount) {
  const postId = job.platformId;
  if (
    job.accountId !== account.id ||
    job.kind !== "publish" ||
    job.status !== "succeeded" ||
    typeof postId !== "string"
  )
    return;
  if (account.platform === "reddit") {
    if (postPattern.test(postId))
      return { postId, url: `https://www.reddit.com/comments/${postId.slice(3)}/` };
    return;
  }
  if (!postId.startsWith(`${account.platformId}:`)) return;
  try {
    const { chatId, messageId } = parseTelegramPlatformId(postId);
    const channel = -Number(chatId) - 1_000_000_000_000;
    if (!Number.isSafeInteger(channel) || channel < 1 || channel > 997_852_516_352) return;
    return { postId, url: `https://t.me/c/${channel}/${messageId}` };
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "rejected") return;
    throw error;
  }
}

function publishedPostActions(platform: Platform): SocialActionModule {
  return {
    [`${platform}.posts.published`]: {
      ownerOnly: true,
      readOnly: true,
      async run(ctx, input): Promise<PublishedPosts> {
        exact(input, ["accountId", "offset"]);
        const account = await accountFor(ctx, input.accountId, platform);
        const offset = input.offset ?? 0;
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
          throw new SocialPlatformError("rejected");
        const { snapshot } = (await ctx.service.call(ctx.principal, "workspace.snapshot", {
          section: "history",
          limit: 50,
          offsets: { jobs: offset },
          filters: { jobs: { accountId: account.id, kind: "publish", status: "succeeded" } },
        })) as SocialWorkspaceResponse;
        const page = snapshot?.pages?.jobs;
        const targets = (snapshot?.jobs ?? []).flatMap((job) => {
          const target = publishedTarget(job, account);
          return target ? [{ job, target }] : [];
        });
        const posts = await Promise.all(
          targets.map(async ({ job, target }) => ({
            jobId: job.id,
            ...target,
            title:
              (platform === "reddit" ? job.payload.reddit?.title?.trim() : undefined) ||
              job.payload.text.trim(),
            ...(platform === "reddit" ? { subreddit: job.payload.reddit?.subreddits?.[0] } : {}),
            deletion: await receipt(ctx, receiptKey(account, target.postId)),
          })),
        );
        const next = page ? page.offset + page.limit : 0;
        return { posts, ...(page && next < page.total ? { next } : {}) };
      },
    },
    [`${platform}.post.delete`]: {
      ownerOnly: true,
      readOnly: false,
      async run(ctx, input): Promise<{ status: PublishedPostDeletion }> {
        exact(input, ["accountId", "jobId", "postId", "confirm"]);
        if (input.confirm !== `DELETE_${platform.toUpperCase()}_POST`)
          throw new SocialPlatformError("denied");
        const account = await accountFor(ctx, input.accountId, platform);
        const jobId = str(input.jobId, "job");
        const job = (await ctx.service.call(ctx.principal, "jobs.status", {
          id: jobId,
        })) as SocialJob;
        const target = publishedTarget(job, account);
        if (!target || input.postId !== target.postId) throw new SocialPlatformError("denied");
        const postId = target.postId;
        const key = receiptKey(account, postId);
        const writing = active.get(ctx.service) ?? new Set<string>();
        active.set(ctx.service, writing);
        if (writing.has(key)) throw new SocialPlatformError("denied");
        writing.add(key);
        try {
          const previous = await receipt(ctx, key);
          if (previous) return { status: previous };
          const current = async () => {
            const accountNow = await accountFor(ctx, account.id, platform);
            if (
              !accountNow.connected ||
              !accountNow.accessApproved ||
              accountNow.paused ||
              accountNow.executorId !== ctx.environmentId ||
              accountNow.platformId !== account.platformId ||
              accountNow.telegramBotId !== account.telegramBotId ||
              accountNow.connection !== account.connection ||
              (await ctx.service.setting("stopped")) === "true" ||
              (await ctx.service.setting("sending")) !== "true"
            )
              throw new SocialPlatformError("denied");
            ctx.service.capability(accountNow, "delete");
            if (accountNow.connection === "browser") return { accountNow, token: "" };
            const credential = await ctx.service.credentialFor(accountNow.id);
            if (
              !credential?.accessToken ||
              (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now())
            )
              throw new SocialPlatformError("expired");
            return { accountNow, token: credential.accessToken };
          };
          const { accountNow, token } = await current();
          const adapter = ctx.service.adapterFor(accountNow);
          if (!adapter.deletePost) throw new SocialPlatformError("unsupported");
          let submitted = false;
          try {
            await adapter.deletePost(accountNow, token, postId, async () => {
              const latest = await current();
              if (latest.token !== token) throw new SocialPlatformError("denied");
              if (!submitted) {
                await ctx.service.setSetting(key, "review");
                submitted = true;
              }
            });
            if (!submitted) throw new SocialPlatformError("unknown");
            await ctx.service.setSetting(key, "deleted");
            return { status: "deleted" };
          } catch (error) {
            if (!submitted) throw error;
            if (
              accountNow.connection !== "browser" &&
              error instanceof SocialPlatformError &&
              ["denied", "expired", "rate_limit", "rejected"].includes(error.code)
            ) {
              // API adapters reserve these codes for refusals before or at submission.
              await ctx.service.deleteSetting(key);
              throw error;
            }
            return { status: "review" };
          }
        } finally {
          writing.delete(key);
        }
      },
    },
  };
}

export const ownerPublishedPostActions: SocialActionModule = {
  ...publishedPostActions("reddit"),
  ...publishedPostActions("telegram"),
};
