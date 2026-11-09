import { afterEach, describe, expect, it } from "vitest";
import type {
  SocialCampaign,
  SocialDraft,
  SocialJob,
  SocialThread,
} from "../../src/features/social/model/social";
import { activate, createPlan, fixture, runCleanups } from "./social-test-support";
import type { SocialPrincipal } from "./social";

afterEach(runCleanups);

describe("durable owner-approved publishing plans: autonomous publish", () => {
  it("publishes an unapproved pool campaign without owner approval only when publish autonomy is autonomous", async () => {
    const s = await fixture();
    const account = await s.account();
    const campaign = await s.call<SocialCampaign>("campaigns.create", {
      name: "Unapproved announcement",
      projectIds: [s.a.id],
      variants: [
        {
          accountId: account.id,
          text: "Public owner-authored announcement.",
          scheduledAt: s.clock.value,
          media: [],
          factIds: [],
        },
      ],
    });
    const plan = await createPlan(s, account, [campaign]);
    await expect(activate(s, plan)).rejects.toThrow("approval changed");
    expect(s.send).not.toHaveBeenCalled();
    await s.call("autonomy.set", {
      accountId: account.id,
      policy: { levels: { publish: "autonomous" } },
      confirm: "ENABLE_AUTONOMY",
    });
    await s.enable();
    await activate(s, plan);
    await s.social.tick();
    expect(s.send).toHaveBeenCalledTimes(1);
    const jobs = await s.call<SocialJob[]>("jobs.status");
    expect(jobs[0].approval).toMatchObject({ kind: "autonomy", accountId: account.id });
  });
});

describe("autonomy, suppression and AI stop wiring", () => {
  const aiReply = async (
    s: Awaited<ReturnType<typeof fixture>>,
    ai: SocialPrincipal,
    threadId: string,
  ) => {
    const draft = await s.call<SocialDraft>("replies.draft", { threadId, text: "Thanks" }, ai);
    return await s.call<SocialJob>("replies.send", { id: draft.id }, ai);
  };
  const autonomy = async (
    s: Awaited<ReturnType<typeof fixture>>,
    accountId: string,
    level: "approve" | "autonomous",
  ) =>
    await s.call("autonomy.set", {
      accountId,
      policy: { levels: { reply: level } },
      ...(level === "autonomous" ? { confirm: "ENABLE_AUTONOMY" } : {}),
    });

  it("an autonomous AI reply is queued with an autonomy approval and sent without owner approval", async () => {
    const s = await fixture();
    const account = await s.account();
    const thread = await s.thread(account);
    const ai = (await s.session()).principal;
    await autonomy(s, account.id, "autonomous");
    // Autonomous AI actions are refused at queue time while external sending is off (see the
    // "refused while external sending is off" test), so sending is turned on first.
    await s.enable();
    const job = await aiReply(s, ai, thread.id);
    expect(job.approval).toMatchObject({ kind: "autonomy", accountId: account.id });
    await s.social.tick();
    expect(s.send).toHaveBeenCalledTimes(1);
    const logged = await s.social.audience.listAiActions({});
    expect(logged.items.map((item) => item.action)).toContain("replies.send");
  });

  it("a suggest-level AI reply still needs owner approval", async () => {
    const s = await fixture();
    const account = await s.account();
    const thread = await s.thread(account);
    const ai = (await s.session()).principal;
    await expect(aiReply(s, ai, thread.id)).rejects.toThrow("Owner approval required");
  });

  it("an approve-level AI reply waits in review until the owner approves its draft", async () => {
    const s = await fixture();
    const account = await s.account();
    const thread = await s.thread(account);
    const ai = (await s.session()).principal;
    await autonomy(s, account.id, "approve");
    const job = await aiReply(s, ai, thread.id);
    expect(job).toMatchObject({ status: "review", reviewReason: "awaiting_approval" });
    await s.approveDraft(job.draftId!);
    expect((await s.call<SocialJob[]>("jobs.status"))[0].status).toBe("queued");
  });

  it("the global AI stop refuses AI replies until the owner resumes", async () => {
    const s = await fixture();
    const account = await s.account();
    const thread = await s.thread(account);
    const ai = (await s.session()).principal;
    await autonomy(s, account.id, "autonomous");
    await s.enable();
    await s.call("ai.stop", {}, ai);
    await expect(aiReply(s, ai, thread.id)).rejects.toThrow("stopped by the owner");
    await s.call("ai.resume", {});
    await expect(aiReply(s, ai, thread.id)).resolves.toMatchObject({ kind: "reply" });
  });

  it("an autonomous reply is refused while external sending is off", async () => {
    const s = await fixture();
    const account = await s.account();
    const thread = await s.thread(account);
    const ai = (await s.session()).principal;
    await autonomy(s, account.id, "autonomous");
    await expect(aiReply(s, ai, thread.id)).rejects.toThrow("External sending is off");
  });

  it("an opt-out on one account suppresses the same platform identity on another account", async () => {
    const s = await fixture();
    const first = await s.account("x", [s.a.id], "First");
    const second = await s.account("x", [s.a.id], "Second");
    const firstThread = await s.thread(first, "event-first");
    await s.call("contacts.optout", { id: firstThread.contactId });
    await s.thread(second, "event-second");
    // s.thread returns the first thread in insertion order; pick the second account's own thread.
    const secondThread = (await s.call<SocialThread[]>("inbox.list")).find(
      (thread) => thread.accountId === second.id,
    )!;
    const draft = await s.call<SocialDraft>("replies.draft", {
      threadId: secondThread.id,
      text: "Hi",
    });
    await s.approveDraft(draft.id);
    await expect(s.call("replies.send", { id: draft.id })).rejects.toThrow("suppressed");
  });

  it("revoking the project grant cancels a queued approved reply before dispatch", async () => {
    const s = await fixture();
    const account = await s.account();
    const thread = await s.thread(account);
    const draft = await s.call<SocialDraft>("replies.draft", {
      threadId: thread.id,
      text: "Thanks",
    });
    await s.approveDraft(draft.id);
    await s.call("replies.send", { id: draft.id });
    await s.call("accounts.grants", {
      accountId: account.id,
      projectId: s.a.id,
      permissions: ["read"],
    });
    await s.enable();
    await s.social.tick();
    expect(s.send).not.toHaveBeenCalled();
    expect((await s.call<SocialJob[]>("jobs.status"))[0].status).toBe("cancelled");
  });

  it("LinkedIn follows the same autonomy policy for AI replies", async () => {
    const s = await fixture();
    const account = await s.account("linkedin");
    // LinkedIn has no general messaging API (message.reply is unsupported), so the AI reply targets
    // a comment thread, which the LinkedIn API supports through reply.
    const thread = await s.thread(account, "event-1", "hello", "comment");
    const ai = (await s.session()).principal;
    await autonomy(s, account.id, "autonomous");
    await s.enable();
    const job = await aiReply(s, ai, thread.id);
    expect(job.approval).toMatchObject({ kind: "autonomy", accountId: account.id });
    await s.social.tick();
    expect(s.send).toHaveBeenCalledTimes(1);
  });
});
