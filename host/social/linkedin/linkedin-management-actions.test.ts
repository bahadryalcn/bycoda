import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SocialAccount,
  SocialJob,
  SocialThread,
} from "../../../src/features/social/model/social";
import { SocialPlatformError, type SocialAdapter } from "../../../src/integrations/social/adapter";
import type { LinkedInManagementReview } from "../../../src/integrations/social/adapters/linkedin-manage";
import { fixture, runCleanups } from "../social-test-support";

afterEach(runCleanups);

const postId = "urn:li:ugcPost:42";
const commentId = "urn:li:comment:(urn:li:activity:71,92)";

async function setup() {
  const f = await fixture();
  const account = await f.call<SocialAccount>("accounts.create", {
    platform: "linkedin",
    accountType: "member",
    name: "Member",
    connection: "oauth",
    projectIds: [f.a.id],
  });
  const identity = {
    platformId: "urn:li:person:synthetic",
    name: account.name,
    scopes: ["w_member_social", "w_member_social_feed"],
    accessApproved: true,
    connection: "oauth" as const,
  };
  const reconnect = () =>
    f.social.connectAccount(account.id, identity, { accessToken: "fixture-token" });
  await reconnect();
  const grant = (projectId: string, permissions: string[]) =>
    f.call("accounts.grants", { accountId: account.id, projectId, permissions });
  await grant(f.a.id, ["read", "publish", "comment"]);
  const job: SocialJob = {
    id: "job",
    operationId: "fixture",
    dedupeKey: "fixture",
    accountId: account.id,
    projectIds: [f.a.id],
    provider: "owner",
    kind: "publish",
    payload: { text: "Original post", media: [] },
    status: "succeeded",
    platformId: postId,
    scheduledAt: f.clock.value,
    attempts: 1,
    createdAt: f.clock.value,
    actorId: "owner",
  };
  await f.social.writeJob(job);
  await f.social.ingest(account.id, [
    {
      eventId: commentId,
      threadId: commentId,
      postId,
      contactId: "urn:li:person:commenter",
      contactName: "Commenter",
      text: "Hello",
      kind: "comment",
      at: f.clock.value,
    },
  ]);
  const [thread] = await f.call<SocialThread[]>("inbox.list");
  const { principal } = await f.session(f.a.id);
  const providerWrite = vi.fn(async () => ({ platformId: postId }));
  const manage = vi.fn<NonNullable<SocialAdapter["linkedinManage"]>>(
    async (_account, _token, _action, beforeSubmit) => {
      await beforeSubmit();
      return await providerWrite();
    },
  );
  f.adapters.linkedin.linkedinManage = manage;
  const prepare = (input: Record<string, unknown>) =>
    f.call<LinkedInManagementReview>(
      "linkedin.management.prepare",
      { accountId: account.id, ...input },
      principal,
    );
  const submit = (review: LinkedInManagementReview) =>
    f.call<LinkedInManagementReview>("linkedin.management.submit", {
      id: review.id,
      accountId: account.id,
      reviewed: review,
    });
  const read = (review: LinkedInManagementReview) =>
    f.call<LinkedInManagementReview>("linkedin.management.get", {
      id: review.id,
      accountId: account.id,
    });
  return {
    f,
    account,
    job,
    thread,
    principal,
    manage,
    providerWrite,
    prepare,
    submit,
    read,
    grant,
    reconnect,
  };
}

describe("LinkedIn management Host approvals", () => {
  it("keeps mutation and review access owner-only, rejects a changed review, and audits an accepted delete", async () => {
    const test = await setup();
    const { f, account, job, principal, prepare, submit, providerWrite, manage } = test;
    const review = await prepare({ kind: "deletePost", jobId: job.id });
    expect(providerWrite).not.toHaveBeenCalled();
    await expect(
      f.call("linkedin.management.get", { id: review.id, accountId: account.id }, principal),
    ).rejects.toThrow("owner");
    await expect(
      f.call(
        "linkedin.management.submit",
        { id: review.id, accountId: account.id, reviewed: review },
        principal,
      ),
    ).rejects.toThrow("owner");
    await f.enable();
    await expect(
      submit({ ...review, action: { kind: "deletePost", postId: "urn:li:ugcPost:99" } }),
    ).rejects.toThrow("review changed");
    expect(providerWrite).not.toHaveBeenCalled();
    // Native JSON transports may reorder object keys.
    const reordered = Object.fromEntries(
      Object.entries(review).reverse(),
    ) as LinkedInManagementReview;
    await expect(submit(reordered)).resolves.toMatchObject({ state: "succeeded" });
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({ id: account.id }),
      "fixture-token",
      {
        kind: "deletePost",
        postId,
      },
      expect.any(Function),
    );
    const log = await f.store.db
      .prepare("SELECT value FROM social_audit WHERE json_extract(value,'$.action') = ?")
      .all("linkedin.management.submit");
    expect(log.map((row) => JSON.parse(String(row.value)))).toContainEqual(
      expect.objectContaining({ outcome: "success", socialAccountId: account.id }),
    );
  });

  it("blocks a revoked project grant, a different executor, and the global stop", async () => {
    const { f, account, job, prepare, submit, providerWrite, grant } = await setup();
    const review = await prepare({ kind: "editPost", jobId: job.id, text: "Correction" });
    await expect(submit(review)).rejects.toMatchObject({ code: "denied" });
    await f.enable();
    await grant(f.a.id, ["read"]);
    await expect(submit(review)).rejects.toMatchObject({ code: "denied" });
    await grant(f.a.id, ["read", "publish"]);
    await f.call("accounts.executor", { accountId: account.id, executorId: "different-host" });
    await expect(submit(review)).rejects.toMatchObject({ code: "denied" });
    await f.call("accounts.executor", { accountId: account.id, executorId: f.store.environmentId });
    await f.call("execution.stop");
    await expect(submit(review)).rejects.toMatchObject({ code: "denied" });
    expect(providerWrite).not.toHaveBeenCalled();
  });

  it("binds accepted comments and rechecks project assignment and suppression before submission", async () => {
    const { f, account, thread, prepare, submit, grant, manage, providerWrite } = await setup();
    const approved = await prepare({ kind: "react", threadId: thread.id, reaction: "LIKE" });
    expect(approved.action).toEqual({ kind: "react", entityId: commentId, reaction: "LIKE" });
    await f.enable();
    await grant(f.b.id, ["read", "comment"]);
    await f.call("thread.assign", { id: thread.id, projectId: f.b.id });
    await expect(submit(approved)).rejects.toMatchObject({ code: "denied" });
    expect(providerWrite).not.toHaveBeenCalled();
    await f.call("thread.assign", { id: thread.id, projectId: f.a.id });
    await expect(submit(approved)).resolves.toMatchObject({ state: "succeeded" });
    const removal = await prepare({ kind: "removeReaction", threadId: thread.id });
    manage.mockImplementationOnce(async (_account, _token, _action, beforeSubmit) => {
      await f.call("contacts.optout", { id: thread.contactId });
      await beforeSubmit();
      return await providerWrite();
    });
    await expect(submit(removal)).rejects.toThrow("suppressed");
    await expect(prepare({ kind: "deleteComment", threadId: thread.id })).rejects.toThrow(
      "suppressed",
    );
    expect(providerWrite).toHaveBeenCalledTimes(1);
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({ id: account.id }),
      "fixture-token",
      {
        kind: "react",
        entityId: commentId,
        reaction: "LIKE",
      },
      expect.any(Function),
    );
  });

  it("keeps a post-submit failure for inspection and refuses another change to that post", async () => {
    const { f, job, prepare, submit, read, providerWrite } = await setup();
    await f.enable();
    const review = await prepare({ kind: "editPost", jobId: job.id, text: "First change" });
    const otherReview = await prepare({ kind: "deletePost", jobId: job.id });
    providerWrite.mockRejectedValueOnce(new SocialPlatformError("unknown"));
    await expect(submit(review)).rejects.toMatchObject({ code: "unknown" });
    await f.restart();
    await expect(read(review)).resolves.toMatchObject({ state: "inspect" });
    await expect(submit(review)).rejects.toThrow("review changed");
    await expect(submit(otherReview)).rejects.toMatchObject({ code: "unknown" });
    await expect(
      prepare({ kind: "editPost", jobId: job.id, text: "Different change" }),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(providerWrite).toHaveBeenCalledTimes(1);
  });

  it("uses the accepted share or UGC root when submitting a comment deletion", async () => {
    const { f, account, thread, prepare, submit, manage } = await setup();
    const review = await prepare({ kind: "deleteComment", threadId: thread.id });
    await f.enable();
    await expect(submit(review)).resolves.toMatchObject({ state: "succeeded" });
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({ id: account.id }),
      "fixture-token",
      { kind: "deleteComment", postId, commentId },
      expect.any(Function),
    );
  });

  it("does not carry an approval through disconnection and reconnection", async () => {
    const { f, account, job, prepare, submit, reconnect, providerWrite } = await setup();
    await f.enable();
    const review = await prepare({ kind: "deletePost", jobId: job.id });
    await f.call("accounts.disconnect", { accountId: account.id });
    await reconnect();
    await f.call("accounts.pause", { accountId: account.id, paused: false });
    await expect(submit(review)).rejects.toMatchObject({ code: "denied" });
    expect(providerWrite).not.toHaveBeenCalled();
  });
});
