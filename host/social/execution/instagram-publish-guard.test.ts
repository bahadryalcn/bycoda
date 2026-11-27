import { afterEach, expect, it } from "vitest";
import type { SocialCampaign, SocialJob } from "../../../src/features/social/model/social";
import { fixture, runCleanups } from "../social-test-support";

afterEach(runCleanups);

it.each([false, true])(
  "preserves a scheduled Instagram Story and checks suppression at dispatch (%s)",
  async (blocked) => {
    const f = await fixture();
    const account = await f.account("instagram");
    await f.call("contacts.upsert", {
      accountId: account.id,
      platformId: "1234567890",
      name: "viewer",
      projectIds: [f.a.id],
    });
    const scheduledAt = f.clock.value + 60_000;
    const instagram = { format: "story", userTags: [{ username: "VIEWER" }] };
    const campaign = await f.call<SocialCampaign>("campaigns.create", {
      name: "Scheduled Story",
      projectIds: [f.a.id],
      variants: [
        {
          accountId: account.id,
          text: "",
          media: [{ kind: "image", url: "https://cdn.test/story.jpg" }],
          instagram,
          scheduledAt,
        },
      ],
    });
    await f.call("campaigns.approve", { id: campaign.id });
    const [job] = await f.call<SocialJob[]>("campaigns.schedule", { id: campaign.id });
    expect(job).toMatchObject({
      status: "queued",
      scheduledAt,
      payload: { instagram: { format: "story", userTags: [{ username: "viewer" }] } },
    });
    if (blocked) {
      await f.call("suppressions.add", {
        handle: "instagram:1234567890",
        channel: "mention",
        reason: "manual",
      });
    }
    await f.enable();
    await f.social.tick();
    expect(f.send).not.toHaveBeenCalled();
    f.clock.value = scheduledAt;
    await f.social.tick();
    expect(f.send).toHaveBeenCalledTimes(blocked ? 0 : 1);
    const status = await f.call<SocialJob>("jobs.status", { id: job.id });
    expect(status.status).toBe(blocked ? "cancelled" : "succeeded");
  },
);
