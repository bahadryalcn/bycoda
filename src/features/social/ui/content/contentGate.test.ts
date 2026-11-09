import { describe, expect, it } from "vitest";
import type { SocialJob, SocialSnapshot } from "../../model/social";
import { draftGate, postHasLockingJob, publishGate } from "./contentGate";

const shell = { hostOnline: true, unreachable: false, aiStopped: false };
const snapshot = { sendingEnabled: true } as SocialSnapshot;
const base = { snapshot, projectId: "p1", shell, busy: false };

describe("publish gate", () => {
  it("gives the first closed reason in the order the owner fixes things", () => {
    expect(publishGate({ ...base, snapshot: undefined, problems: [] })).toEqual({
      disabled: true,
      disabledReason: "Loading accounts…",
    });
    expect(publishGate({ ...base, projectId: undefined, problems: [] })).toMatchObject({
      disabled: true,
      disabledReason: "Choose a project first.",
    });
    expect(
      publishGate({ ...base, shell: { ...shell, hostOnline: false }, problems: [] }),
    ).toMatchObject({
      disabled: true,
    });
    expect(publishGate({ ...base, locked: "Locked.", problems: [{ text: "x" }] })).toEqual({
      disabled: true,
      disabledReason: "Locked.",
    });
  });

  it("says sending is off and points to Accounts & Settings", () => {
    expect(
      publishGate({ ...base, snapshot: { sendingEnabled: false } as SocialSnapshot, problems: [] }),
    ).toEqual({
      disabled: true,
      disabledReason: "Sending is off. Turn it on in Accounts & Settings.",
      fix: "accounts",
    });
  });

  it("shows the first problem as the reason, and is enabled when there are none", () => {
    expect(publishGate({ ...base, problems: [{ text: "First." }, { text: "Second." }] })).toEqual({
      disabled: true,
      disabledReason: "First.",
    });
    expect(publishGate({ ...base, problems: [] })).toEqual({ disabled: false });
  });
});

describe("draft gate", () => {
  it("needs an account and content but not sending", () => {
    const noSending = { ...base, snapshot: { sendingEnabled: false } as SocialSnapshot };
    expect(draftGate({ ...noSending, hasAccounts: true, hasContent: true })).toEqual({
      disabled: false,
    });
    expect(draftGate({ ...noSending, hasAccounts: false, hasContent: true })).toMatchObject({
      disabledReason: "Choose at least one account.",
    });
    expect(draftGate({ ...noSending, hasAccounts: true, hasContent: false })).toMatchObject({
      disabledReason: "Write the post or attach media.",
    });
  });
});

describe("post lock by job state", () => {
  const job = (campaignId: string, status: SocialJob["status"]) =>
    ({ campaignId, status }) as SocialJob;

  it.each(["queued", "running", "succeeded", "review"] as const)(
    "locks a post with a %s job",
    (status) => {
      expect(postHasLockingJob("c1", [job("c1", status)])).toBe(true);
    },
  );

  it.each(["failed", "cancelled"] as const)(
    "leaves a post with only a %s job editable",
    (status) => {
      expect(postHasLockingJob("c1", [job("c1", status)])).toBe(false);
    },
  );

  it("locks a failed post when a newer retry is queued, and ignores other posts", () => {
    expect(postHasLockingJob("c1", [job("c1", "failed"), job("c1", "queued")])).toBe(true);
    expect(postHasLockingJob("c1", [job("c2", "queued")])).toBe(false);
    expect(postHasLockingJob("c1", [])).toBe(false);
  });
});
