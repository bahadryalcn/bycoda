import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { SocialDraft, SocialJob, SocialRule } from "../../src/features/social/model/social";
import { RETRY_ATTEMPT_LIMIT, RETRY_WINDOW_MS } from "./execution/social-job-gates";
import type { SocialTextGenerator } from "./social-generation";
import { fixture, owner, runCleanups } from "./social-test-support";

afterEach(runCleanups);

describe("dispatch retry cap (owner decision D10)", () => {
  it("moves a rate-limited job to review after the eighth attempt and never resends it", async () => {
    const s = await fixture();
    const account = await s.account();
    const campaign = await s.campaign([account]);
    await s.call("campaigns.schedule", { id: campaign.id });
    await s.enable();
    s.send.mockRejectedValue(new SocialPlatformError("rate_limit", s.clock.value + 1000));
    for (let attempt = 0; attempt < RETRY_ATTEMPT_LIMIT; attempt++) {
      s.clock.value += 60_001;
      await s.social.tick();
    }
    expect(s.send).toHaveBeenCalledTimes(RETRY_ATTEMPT_LIMIT);
    s.clock.value += 60_001;
    await s.social.tick();
    expect(s.send).toHaveBeenCalledTimes(RETRY_ATTEMPT_LIMIT);
    expect((await s.call<SocialJob[]>("jobs.status"))[0]).toMatchObject({
      status: "review",
      reviewReason: "retry_exhausted",
      attempts: RETRY_ATTEMPT_LIMIT,
    });
  });

  it("moves a rate-limited job to review once its 72-hour window closes, with attempts left", async () => {
    const s = await fixture();
    const account = await s.account();
    const campaign = await s.campaign([account]);
    await s.call("campaigns.schedule", { id: campaign.id });
    await s.enable();
    s.send.mockRejectedValue(new SocialPlatformError("rate_limit", s.clock.value + 1000));
    s.clock.value += 60_001;
    await s.social.tick();
    expect((await s.call<SocialJob[]>("jobs.status"))[0]).toMatchObject({
      status: "queued",
      attempts: 1,
    });
    s.clock.value += RETRY_WINDOW_MS + 60_001;
    // D10: once the window has closed the queued retry is held for review before any send.
    await s.social.tick();
    expect(s.send).toHaveBeenCalledTimes(1);
    expect((await s.call<SocialJob[]>("jobs.status"))[0]).toMatchObject({
      status: "review",
      reviewReason: "retry_exhausted",
      attempts: 1,
    });
  });
});

describe("suppression on the AI send path", () => {
  it("refuses an AI-sent reply to a contact that opted out after the owner approved the draft", async () => {
    const s = await fixture();
    const account = await s.account();
    const thread = await s.thread(account);
    const draft = await s.call<SocialDraft>("replies.draft", {
      threadId: thread.id,
      text: "Thanks",
    });
    await s.approveDraft(draft.id);
    await s.call("contacts.optout", { id: thread.contactId });
    const ai = (await s.session()).principal;
    await s.call("autonomy.set", {
      accountId: account.id,
      policy: { levels: { reply: "autonomous" } },
      confirm: "ENABLE_AUTONOMY",
    });
    await s.enable();
    // Opt-out is checked on the contact before the suppression gate, so the opt-out message is the one shown.
    await expect(s.call("replies.send", { id: draft.id }, ai)).rejects.toThrow(
      "Contact opted out. Pending outreach is stopped.",
    );
    await s.social.tick();
    expect(s.send).not.toHaveBeenCalled();
  });
});

describe("LinkedIn follows the rule and AI policy like other platforms (owner decision D3)", () => {
  it("lets an active automatic rule on a LinkedIn account queue its generated reply", async () => {
    const generator = vi.fn<SocialTextGenerator>(async () =>
      JSON.stringify({ text: "Verified public answer." }),
    );
    const s = await fixture(generator);
    const account = await s.account("linkedin");
    await s.call("profiles.save", {
      projectId: s.a.id,
      productName: "Product",
      brandVoice: "Warm",
      facts: [
        {
          id: "fact",
          topic: "release",
          text: "Verified public answer.",
          source: "Owner announcement",
        },
      ],
    });
    const rule = await s.call<SocialRule>("automations.create", {
      accountId: account.id,
      projectId: s.a.id,
      name: "LinkedIn reply",
      agent: { provider: "codex", model: "rule-model" },
      mode: "automatic",
      trigger: "message",
      topics: ["release"],
      dailyLimit: 1,
      answers: [{ keyword: "release", factId: "fact" }],
    });
    await s.call("automations.activate", { id: rule.id, confirm: "ENABLE_AUTOMATIC_REPLIES" });
    await s.thread(account, "event", "release");
    const [draft] = (await s.social.snapshot(owner)).drafts;
    // Generation drafts carry the same preparing marker on every platform; it is not a LinkedIn exclusion.
    expect(draft.reviewReason).toBe(
      "Selected AI agent is preparing this reply. Sending is blocked until validation.",
    );
    expect(draft.generation?.status).toBe("queued");
    expect(generator).not.toHaveBeenCalled();
    await s.enable();
    await s.social.tick();
    expect(generator).toHaveBeenCalledTimes(1);
  });
});
