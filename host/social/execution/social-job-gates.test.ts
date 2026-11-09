import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../../src/features/social/model/social";
import { SocialPlatformError, type SocialAdapter } from "../../../src/integrations/social/adapter";
import type { SocialPrincipal } from "../social";
import type { SocialServiceInternals } from "../core/social-internals";
import {
  approvalJobFields,
  assertJobAuthority,
  draftAutonomy,
  holdExhaustedRetry,
  releaseAwaitingApproval,
  RETRY_ATTEMPT_LIMIT,
  RETRY_WINDOW_MS,
  retryExhausted,
  sendWithFallback,
} from "./social-job-gates";

const HOUR = 60 * 60 * 1000;
const job = (overrides: Partial<SocialJob> = {}) =>
  ({
    id: "j1",
    accountId: "acc",
    kind: "reply",
    actorId: "owner:me",
    status: "running",
    attempts: 1,
    scheduledAt: 0,
    createdAt: 0,
    projectIds: ["p1"],
    payload: { text: "hi", media: [] },
    ...overrides,
  }) as SocialJob;
const account = (overrides: Partial<SocialAccount> = {}) =>
  ({
    id: "acc",
    platform: "x",
    connection: "api",
    grants: { p1: ["read", "reply"] },
    ...overrides,
  }) as SocialAccount;
const adapter = (send: SocialAdapter["send"]) =>
  ({ send, poll: vi.fn() }) as unknown as SocialAdapter;
const result = { platformId: "remote-1" };

describe("retryExhausted (B03, D10)", () => {
  it("stops after the attempt limit or after 72 hours from creation", () => {
    expect(retryExhausted(job({ attempts: RETRY_ATTEMPT_LIMIT - 1 }), HOUR)).toBe(false);
    expect(retryExhausted(job({ attempts: RETRY_ATTEMPT_LIMIT }), HOUR)).toBe(true);
    expect(retryExhausted(job({ attempts: 1, createdAt: 0 }), RETRY_WINDOW_MS)).toBe(true);
    expect(retryExhausted(job({ attempts: 1, createdAt: 0 }), RETRY_WINDOW_MS - 1)).toBe(false);
  });
});

describe("holdExhaustedRetry (D10, checked before a send)", () => {
  const harness = (now: number) => {
    const writeJob = vi.fn(async (value: SocialJob) => value);
    return { deps: { now: () => now, writeJob }, writeJob };
  };

  it("holds a failed retry whose window has closed and records review, without sending", async () => {
    const { deps, writeJob } = harness(RETRY_WINDOW_MS + 1);
    const failed = job({
      status: "queued",
      attempts: 1,
      createdAt: 0,
      error: "Platform rate limit reached.",
    });
    await expect(holdExhaustedRetry(deps, failed)).resolves.toBe(true);
    expect(failed).toMatchObject({ status: "review", reviewReason: "retry_exhausted" });
    expect(writeJob).toHaveBeenCalledWith(failed);
  });

  it("keeps a failed retry while its window is still open", async () => {
    const { deps, writeJob } = harness(HOUR);
    const failed = job({
      status: "queued",
      attempts: 1,
      createdAt: 0,
      error: "Platform rate limit reached.",
    });
    await expect(holdExhaustedRetry(deps, failed)).resolves.toBe(false);
    expect(failed.status).toBe("queued");
    expect(writeJob).not.toHaveBeenCalled();
  });

  it("keeps fresh scheduled work that has not been attempted, even when created long ago", async () => {
    const { deps, writeJob } = harness(RETRY_WINDOW_MS + 1);
    const fresh = job({ status: "queued", attempts: 0, createdAt: 0 });
    await expect(holdExhaustedRetry(deps, fresh)).resolves.toBe(false);
    expect(fresh.status).toBe("queued");
    expect(writeJob).not.toHaveBeenCalled();
  });

  it("keeps a job an owner requeued from human review, whose error was cleared", async () => {
    const { deps, writeJob } = harness(RETRY_WINDOW_MS + 1);
    const requeued = job({ status: "queued", attempts: 1, createdAt: 0, error: undefined });
    await expect(holdExhaustedRetry(deps, requeued)).resolves.toBe(false);
    expect(requeued.status).toBe("queued");
    expect(writeJob).not.toHaveBeenCalled();
  });
});

describe("assertJobAuthority (B06)", () => {
  const s = { setting: async () => undefined } as unknown as SocialServiceInternals;

  it("rejects a job whose project grant was revoked after queueing", async () => {
    await expect(assertJobAuthority(s, job(), account({ grants: {} }))).rejects.toThrow(
      "Project grant was revoked",
    );
  });

  it("keeps a job while its grant for that operation is present", async () => {
    await expect(assertJobAuthority(s, job(), account())).resolves.toBeUndefined();
  });

  it("holds AI-originated jobs while AI is stopped", async () => {
    const stopped = {
      setting: async (key: string) => (key === "ai.stopped" ? "true" : undefined),
    } as unknown as SocialServiceInternals;
    await expect(
      assertJobAuthority(stopped, job({ sessionId: "s1", actorId: "session:ai" }), account()),
    ).rejects.toThrow("stopped");
    await expect(assertJobAuthority(stopped, job(), account())).resolves.toBeUndefined();
  });
});

describe("sendWithFallback (hybrid mode)", () => {
  const fallbackAccount = account({ fallback: "browser" });

  it("tries the browser once after a pre-submit rate limit", async () => {
    const primary = adapter(
      vi.fn(async () => {
        throw new SocialPlatformError("rate_limit");
      }),
    );
    const browser = adapter(vi.fn(async () => result));
    const out = await sendWithFallback(fallbackAccount, job(), primary, browser, (a, target) =>
      a.send(target, job(), "t", async () => new Uint8Array()),
    );
    expect(out).toEqual(result);
    expect(browser.send).toHaveBeenCalledTimes(1);
    expect((browser.send as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      connection: "browser",
    });
  });

  it("does not fall back for an outcome-uncertain error", async () => {
    const browser = adapter(vi.fn(async () => result));
    await expect(
      sendWithFallback(
        fallbackAccount,
        job(),
        adapter(
          vi.fn(async () => {
            throw new SocialPlatformError("unknown");
          }),
        ),
        browser,
        (a, target) => a.send(target, job(), "t", async () => new Uint8Array()),
      ),
    ).rejects.toThrow();
    expect(browser.send).not.toHaveBeenCalled();
  });

  it("does not fall back without the account's browser fallback", async () => {
    const browser = adapter(vi.fn(async () => result));
    await expect(
      sendWithFallback(
        account(),
        job(),
        adapter(
          vi.fn(async () => {
            throw new SocialPlatformError("unsupported");
          }),
        ),
        browser,
        (a, target) => a.send(target, job(), "t", async () => new Uint8Array()),
      ),
    ).rejects.toThrow();
    expect(browser.send).not.toHaveBeenCalled();
  });

  it("never retries a browser failure a second time", async () => {
    const browser = adapter(
      vi.fn(async () => {
        throw new SocialPlatformError("rate_limit");
      }),
    );
    await expect(
      sendWithFallback(
        fallbackAccount,
        job(),
        adapter(
          vi.fn(async () => {
            throw new SocialPlatformError("rate_limit");
          }),
        ),
        browser,
        (a, target) => a.send(target, job(), "t", async () => new Uint8Array()),
      ),
    ).rejects.toThrow();
    expect(browser.send).toHaveBeenCalledTimes(1);
  });
});

describe("approvalJobFields and draftAutonomy", () => {
  it("keeps owner-approved jobs queued at the fallback time", () => {
    expect(approvalJobFields(undefined, 7)).toEqual({ status: "queued", scheduledAt: 7 });
  });

  it("holds approve-level jobs for review with a reason", () => {
    expect(approvalJobFields({ mode: "approve" }, 7)).toEqual({
      status: "review",
      reviewReason: "awaiting_approval",
      scheduledAt: 7,
    });
  });

  it("carries the autonomy approval and the working-hours time", () => {
    const approval = { kind: "autonomy" as const, accountId: "acc", version: 2 };
    expect(approvalJobFields({ mode: "autonomous", approval, scheduledAt: 99 }, 7)).toEqual({
      status: "queued",
      approval,
      scheduledAt: 99,
    });
  });

  it("keeps the owner refusal for suggest-level drafts and skips covered sends", async () => {
    const deps = {
      audience: { getRecord: async () => undefined, getCounter: async () => 0 },
      setting: async () => undefined,
      now: () => 0,
    } as never;
    const owner = { kind: "owner", actorId: "owner:me", provider: "owner" } as SocialPrincipal;
    await expect(draftAutonomy(deps, owner, "acc", "reply", false)).rejects.toThrow(
      "Owner approval required",
    );
    await expect(draftAutonomy(deps, owner, "acc", "reply", true)).resolves.toBeUndefined();
  });
});

describe("releaseAwaitingApproval", () => {
  it("queues only the jobs held for approval of that draft or campaign", async () => {
    const held = job({ id: "held", status: "review", reviewReason: "awaiting_approval" });
    const seen: string[] = [];
    const s = {
      now: () => 50,
      writeJob: async (value: SocialJob) => {
        seen.push(`${value.id}:${value.status}`);
        return value;
      },
      jobArchive: {
        jobPages: async function* (where: string, values: string[]) {
          expect(where).toContain("status='review'");
          expect(values).toEqual(["draft-1"]);
          yield [held];
        },
      },
    } as never;
    await releaseAwaitingApproval(s, "draftId", "draft-1");
    expect(seen).toEqual(["held:queued"]);
  });
});
