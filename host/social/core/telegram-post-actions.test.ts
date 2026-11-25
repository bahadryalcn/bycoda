import { afterEach, expect, it, vi } from "vitest";
import type { PublishedPosts } from "../../../src/features/social/model/publishedPosts";
import type { SocialAccount, SocialJob } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { createSocialAdapters } from "../../../src/integrations/social/platformAdapters";
import { fixture, runCleanups } from "../social-test-support";

afterEach(runCleanups);
const channelId = "-1001234567890";
const postId = `${channelId}:7`;

async function channelPost(result: boolean) {
  const f = await fixture();
  const account = await f.call<SocialAccount>("accounts.create", {
    name: "Bycoda QA channel",
    platform: "telegram",
    accountType: "channel",
    connection: "token",
    projectIds: [f.a.id],
  });
  await f.social.connectAccount(
    account.id,
    {
      platformId: channelId,
      telegramBotId: "123",
      name: account.name,
      scopes: ["channel.publish"],
      accessApproved: true,
      connection: "token",
    },
    { accessToken: "123:synthetic" },
  );
  const fetcher = vi.fn(async (raw: string | URL | Request, _init?: RequestInit) => {
    const name = String(raw).split("/").at(-1);
    const bot = { id: 123, is_bot: true };
    const response =
      name === "getMe"
        ? bot
        : name === "getChat"
          ? { id: Number(channelId), type: "channel" }
          : name === "getChatMember"
            ? { user: bot, status: "administrator", can_delete_messages: true }
            : result;
    return Response.json({ ok: true, result: response });
  });
  f.adapters.telegram = createSocialAdapters(new SocialHttp(fetcher)).telegram;
  const job: SocialJob = {
    id: "channel-job",
    operationId: "channel-fixture",
    dedupeKey: "channel-job",
    accountId: account.id,
    projectIds: [f.a.id],
    kind: "publish",
    provider: "owner",
    actorId: "owner",
    payload: { text: "QA Telegram post", media: [] },
    platformId: postId,
    status: "succeeded",
    attempts: 1,
    createdAt: f.clock.value,
    scheduledAt: f.clock.value,
  };
  await f.social.writeJob(job);
  await f.enable();
  const input = { accountId: account.id, jobId: job.id, postId, confirm: "DELETE_TELEGRAM_POST" };
  return { f, account, job, input, fetcher };
}

it("deletes only the selected publication through the verified Telegram channel adapter", async () => {
  const { f, job, input, fetcher } = await channelPost(true);
  await f.social.writeJob({
    ...job,
    id: "foreign",
    dedupeKey: "foreign",
    platformId: "-1001000000001:7",
  });
  await expect(
    f.call("telegram.post.delete", { ...input, jobId: "foreign", postId: "-1001000000001:7" }),
  ).rejects.toMatchObject({ code: "denied" });
  const session = await f.session();
  await expect(f.call("telegram.post.delete", input, session.principal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(f.call("telegram.post.delete", input)).resolves.toEqual({ status: "deleted" });
  await expect(f.call("telegram.post.delete", input)).resolves.toEqual({ status: "deleted" });
  expect(fetcher.mock.calls.map(([raw]) => String(raw).split("/").at(-1))).toEqual([
    "getMe",
    "getChat",
    "getChatMember",
    "deleteMessage",
  ]);
  expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({
    chat_id: channelId,
    message_id: 7,
  });
  const posts = await f.call<PublishedPosts>("telegram.posts.published", {
    accountId: input.accountId,
  });
  expect(posts.posts).toEqual([
    {
      jobId: job.id,
      postId,
      title: "QA Telegram post",
      url: "https://t.me/c/1234567890/7",
      deletion: "deleted",
    },
  ]);
});

it("retains a Telegram deletion without a true receipt across Host restart", async () => {
  const { f, input, fetcher } = await channelPost(false);
  await expect(f.call("telegram.post.delete", input)).resolves.toEqual({ status: "review" });
  await f.restart();
  await expect(f.call("telegram.post.delete", input)).resolves.toEqual({ status: "review" });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
