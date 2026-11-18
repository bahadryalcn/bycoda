import { afterEach, expect, it } from "vitest";
import type { SocialDraft, SocialJob, SocialThread } from "../../src/features/social/model/social";
import { fixture, owner, runCleanups } from "./social-test-support";

afterEach(runCleanups);

it("queues an approved Facebook private reply and keeps its text out of the public thread", async () => {
  const s = await fixture();
  const account = await s.account("facebook");
  const thread = await s.thread(account, "private-reply-comment", "Question", "comment");
  const draft = await s.call<SocialDraft>("facebook.privateReplyDraft", {
    threadId: thread.id,
    text: "Private answer",
  });
  expect(draft.facebookPrivateReply).toBe(true);
  await expect(s.call("replies.send", { id: draft.id })).rejects.toThrow("approval");
  await s.approveDraft(draft.id);
  const job = await s.call<SocialJob>("replies.send", { id: draft.id });
  expect(job.payload).toMatchObject({
    facebookPrivateReply: true,
    recipientId: "recipient-1",
    postId: "conversation-1",
  });
  expect((await s.call<SocialJob>("replies.send", { id: draft.id })).id).toBe(job.id);
  await s.enable();
  await s.social.tick();
  expect(s.send).toHaveBeenCalledTimes(1);
  const conversation = await s.call<SocialThread>("thread.read", { id: thread.id });
  expect(conversation.events.map((event) => event.text)).toEqual(["Question"]);
});

it("enforces the project's message grant before queueing a Facebook private reply", async () => {
  const s = await fixture();
  const account = await s.account("facebook");
  const thread = await s.thread(account, "private-reply-permission", "Question", "comment");
  const session = await s.session();
  const draft = await s.call<SocialDraft>(
    "facebook.privateReplyDraft",
    {
      threadId: thread.id,
      text: "Private answer",
    },
    session.principal,
  );
  await s.approveDraft(draft.id);
  await s.call(
    "accounts.grants",
    {
      accountId: account.id,
      projectId: s.a.id,
      permissions: ["read", "draft", "reply"],
    },
    owner,
  );
  await expect(s.call("replies.send", { id: draft.id }, session.principal)).rejects.toThrow(
    "permission",
  );
  expect(s.send).not.toHaveBeenCalled();
});
