import { describe, expect, it } from "vitest";
import type { SocialJob } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { NeedsHumanQueue } from "../browser-layers/needs-human";
import { memorySettings } from "../browser-layers/test-support";
import { UnexpectedScreen } from "../browser-layers/types";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { holdForHuman, requeueJobForHuman } from "./social-human-review";

const summary = {
  url: "https://x.example/layout",
  title: "Changed",
  buttons: [],
  fields: [],
  headings: [],
  errors: [],
};

function job(overrides: Partial<SocialJob> = {}): SocialJob {
  return {
    id: "job-1",
    accountId: "acc",
    kind: "reply",
    status: "running",
    attempts: 1,
    scheduledAt: 1,
    ...overrides,
  } as SocialJob;
}

function service() {
  const settings = memorySettings();
  return {
    settings,
    s: { audience: settings as unknown as SocialAudienceStore, now: () => 50 },
  };
}

describe("holdForHuman", () => {
  it("moves an unexpected screen to review and records a needs-human item without a retry", async () => {
    const { s, settings } = service();
    const target = job();
    expect(await holdForHuman(s, target, "acc", new UnexpectedScreen(summary))).toBe(true);
    expect(target).toMatchObject({ status: "review", reviewReason: "unexpected_screen" });
    const items = await new NeedsHumanQueue(settings).list();
    expect(items).toMatchObject([
      { accountId: "acc", kind: "unexpected", url: summary.url, jobId: "job-1" },
    ]);
  });

  it("keeps the screenshot identity of a needs-human page", async () => {
    const { s, settings } = service();
    const target = job();
    const error = new SocialPlatformError("needs_human", undefined, {
      url: "https://x.example/checkpoint",
      screenshotId: "shot-1",
    });
    expect(await holdForHuman(s, target, "acc", error)).toBe(true);
    expect(target).toMatchObject({ status: "review", reviewReason: "needs_human" });
    expect(await new NeedsHumanQueue(settings).list()).toMatchObject([
      { kind: "verification", screenshotId: "shot-1" },
    ]);
  });

  it("leaves every other error to the caller", async () => {
    const { s, settings } = service();
    const target = job();
    expect(await holdForHuman(s, target, "acc", new SocialPlatformError("rate_limit", 100))).toBe(
      false,
    );
    expect(target.status).toBe("running");
    expect(await new NeedsHumanQueue(settings).list()).toEqual([]);
  });
});

describe("requeueJobForHuman", () => {
  it("returns a job waiting for a person to the queue once", () => {
    const waiting = job({ status: "review", reviewReason: "needs_human", error: "verify" });
    const queued = requeueJobForHuman(waiting, 90);
    expect(queued).toMatchObject({ status: "queued", scheduledAt: 90 });
    expect(queued.reviewReason).toBeUndefined();
    expect(queued.error).toBeUndefined();
    expect(() => requeueJobForHuman(queued, 91)).toThrow("not waiting for a person");
  });

  it("refuses a review job that waits for the owner approval instead", () => {
    expect(() =>
      requeueJobForHuman(job({ status: "review", reviewReason: "awaiting_approval" }), 90),
    ).toThrow("not waiting for a person");
  });
});
