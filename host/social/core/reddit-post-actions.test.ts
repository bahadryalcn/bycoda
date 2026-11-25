import { afterEach, expect, it, vi } from "vitest";
import type { PublishedPosts } from "../../../src/features/social/model/publishedPosts";
import type { SocialJob } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { fixture, runCleanups } from "../social-test-support";

afterEach(runCleanups);

async function publishedPost() {
  const s = await fixture();
  const account = await s.account("reddit");
  const job: SocialJob = {
    id: "reddit-fixture-job",
    operationId: "reddit-fixture-operation",
    accountId: account.id,
    dedupeKey: "reddit-fixture",
    projectIds: [s.a.id],
    kind: "publish",
    provider: "owner",
    actorId: "owner",
    payload: {
      text: "QA post",
      media: [],
      reddit: { title: "QA post", subreddits: ["bycodatest"] },
    },
    platformId: "t3_test123",
    status: "succeeded",
    createdAt: s.clock.value,
    scheduledAt: s.clock.value,
    attempts: 1,
  };
  await s.social.writeJob(job);
  await s.enable();
  const input = {
    accountId: account.id,
    jobId: job.id,
    postId: job.platformId,
    confirm: "DELETE_REDDIT_POST",
  };
  return { s, account, input, job };
}

it("lists only saved publications and persists a verified owner deletion", async () => {
  const { s, account, input, job } = await publishedPost();
  const remove = vi.fn<NonNullable<typeof s.adapters.reddit.deletePost>>(
    async (_account, _token, _postId, guard) => {
      await guard?.();
    },
  );
  s.adapters.reddit.deletePost = remove;
  const other = await s.account("reddit");
  await s.social.writeJob({ ...job, id: "other", dedupeKey: "other", accountId: other.id });
  await expect(s.call("reddit.post.delete", { ...input, jobId: "other" })).rejects.toMatchObject({
    code: "denied",
  });
  await expect(
    s.call("reddit.post.delete", { ...input, postId: "t3_wrong" }),
  ).rejects.toMatchObject({ code: "denied" });
  const session = await s.session();
  await expect(s.call("reddit.post.delete", input, session.principal)).rejects.toThrow();
  await expect(s.call("reddit.post.delete", input)).resolves.toEqual({ status: "deleted" });
  await expect(s.call("reddit.post.delete", input)).resolves.toEqual({ status: "deleted" });
  expect(remove).toHaveBeenCalledOnce();
  expect(remove.mock.calls[0]?.[2]).toBe("t3_test123");
  const page = await s.call<PublishedPosts>("reddit.posts.published", {
    accountId: account.id,
  });
  expect(page.posts).toEqual([
    {
      jobId: input.jobId,
      postId: "t3_test123",
      url: "https://www.reddit.com/comments/test123/",
      title: "QA post",
      subreddit: "bycodatest",
      deletion: "deleted",
    },
  ]);
});

it("holds an uncertain deletion across Host restart", async () => {
  const { s, input } = await publishedPost();
  const remove = vi.fn<NonNullable<typeof s.adapters.reddit.deletePost>>(
    async (_account, _token, _postId, guard) => {
      await guard?.();
      throw new SocialPlatformError("unknown");
    },
  );
  s.adapters.reddit.deletePost = remove;
  await expect(s.call("reddit.post.delete", input)).resolves.toEqual({ status: "review" });
  await s.restart();
  await expect(s.call("reddit.post.delete", input)).resolves.toEqual({ status: "review" });
  expect(remove).toHaveBeenCalledOnce();
});

it("allows another owner-reviewed attempt after an explicit OAuth refusal", async () => {
  const { s, input } = await publishedPost();
  const remove = vi
    .fn<NonNullable<typeof s.adapters.reddit.deletePost>>(
      async (_account, _token, _postId, guard) => {
        await guard?.();
      },
    )
    .mockImplementationOnce(async (_account, _token, _postId, guard) => {
      await guard?.();
      throw new SocialPlatformError("denied");
    });
  s.adapters.reddit.deletePost = remove;
  await expect(s.call("reddit.post.delete", input)).rejects.toMatchObject({ code: "denied" });
  await expect(s.call("reddit.post.delete", input)).resolves.toEqual({ status: "deleted" });
  expect(remove).toHaveBeenCalledTimes(2);
});
