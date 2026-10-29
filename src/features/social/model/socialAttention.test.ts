import { describe, expect, it } from "vitest";
import type { SocialAccount, SocialDraft, SocialJob, SocialSnapshot } from "./social";
import { buildAttention, type AttentionSources } from "./socialAttention";

const base = (patch: Partial<SocialSnapshot> = {}): SocialSnapshot => ({
  executorId: "host",
  hostOnline: true,
  sendingEnabled: true,
  stopped: false,
  pollingEnabled: false,
  accounts: [],
  campaigns: [],
  contacts: [],
  threads: [],
  segments: [],
  rules: [],
  jobs: [],
  drafts: [],
  profiles: [],
  capabilities: {},
  ...patch,
});
const ready = (patch: Partial<SocialSnapshot> = {}) => ({
  status: "ready" as const,
  data: base(patch),
});
const sources = (patch: Partial<AttentionSources> = {}): AttentionSources => ({
  campaigns: ready(),
  inbox: ready(),
  plans: ready(),
  history: ready(),
  programs: { status: "unsupported" },
  ...patch,
});
const account = (id: string, patch: Partial<SocialAccount> = {}): SocialAccount => ({
  id,
  platform: "x",
  platformId: "1",
  name: `Account ${id}`,
  accountType: "member",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: { project: ["read", "draft"] },
  createdAt: 1,
  ...patch,
});
const job = (id: string, status: SocialJob["status"], patch: Partial<SocialJob> = {}): SocialJob => ({
  id,
  operationId: id,
  dedupeKey: id,
  accountId: "a",
  projectIds: ["project"],
  provider: "owner",
  kind: "publish",
  payload: { text: `Post ${id}`, media: [] },
  status,
  scheduledAt: 2_000_000,
  attempts: 1,
  createdAt: 1,
  actorId: "owner",
  ...patch,
});
const draft = (id: string, patch: Partial<SocialDraft> = {}): SocialDraft => ({
  id,
  accountId: "a",
  projectId: "project",
  kind: "reply",
  contactId: "c",
  text: "Hi",
  factIds: [],
  createdAt: 1,
  ...patch,
});

describe("buildAttention", () => {
  it("never reports a failed or loading read as an all-clear and names it as unavailable", () => {
    const result = buildAttention({
      base: base({ accounts: [account("a")] }),
      sources: sources({
        history: { status: "error", message: "Host unreachable" },
        inbox: { status: "loading" },
      }),
      now: 1_000_000,
    });
    expect(result.items).toEqual([]);
    expect(result.unavailable).toEqual([
      { source: "history", state: "error", message: "Host unreachable" },
      { source: "inbox", state: "loading" },
    ]);
  });

  it("separates connection, platform access, pause and project access for accounts", () => {
    const result = buildAttention({
      base: base({
        accounts: [
          account("a", { connected: false }),
          account("b", { accessApproved: false }),
          account("c", { paused: true }),
          account("d", { grants: {} }),
        ],
      }),
      sources: sources(),
      now: 1,
    });
    expect(result.items.map((item) => item.id).sort()).toEqual([
      "accounts-awaiting-access",
      "accounts-disconnected",
      "accounts-no-project",
      "accounts-paused",
    ]);
  });

  it("leads with failed and unverified sends and keeps the do-not-resend warning", () => {
    const result = buildAttention({
      base: base({ accounts: [account("a")] }),
      sources: sources({
        history: ready({
          jobs: [
            job("1", "failed", { error: "Rate limited" }),
            job("2", "failed", { error: "Rate limited" }),
            job("3", "review"),
          ],
        }),
      }),
      now: 1,
    });
    expect(result.items[0]).toMatchObject({
      id: "jobs-problem",
      tone: "danger",
      count: 3,
      target: "Activity",
    });
    expect(result.items[0].detail).toContain("do not resend");
    expect(result.failures).toEqual([{ reason: "Rate limited", count: 2, accounts: ["Account a"] }]);
  });

  it("lists upcoming queued posts in time order from real jobs only", () => {
    const result = buildAttention({
      base: base({ accounts: [account("a")] }),
      sources: sources({
        history: ready({
          jobs: [
            job("late", "queued", { scheduledAt: 5_000_000 }),
            job("soon", "queued", { scheduledAt: 2_000_000 }),
            job("old", "queued", { scheduledAt: 1 }),
          ],
        }),
      }),
      now: 1_000_000,
    });
    expect(result.upcoming.map((item) => item.id)).toEqual(["job:soon", "job:late"]);
  });

  it("counts reply drafts awaiting approval and unscheduled content", () => {
    const result = buildAttention({
      base: base({ accounts: [account("a")] }),
      sources: sources({
        inbox: ready({ drafts: [draft("d1"), draft("d2", { approvedAt: 2 })] }),
        campaigns: ready({
          campaigns: [
            {
              id: "c1",
              name: "Launch",
              projectIds: ["project"],
              variants: [],
              revision: 1,
              paused: false,
              createdAt: 1,
            },
          ],
        }),
      }),
      now: 1,
    });
    expect(result.items.map((item) => [item.id, item.count])).toEqual(
      expect.arrayContaining([
        ["drafts-waiting", 1],
        ["campaigns-draft", 1],
      ]),
    );
  });

  it("reports the offline Host and a stopped queue", () => {
    const result = buildAttention({
      base: base({ hostOnline: false, stopped: true, accounts: [account("a")] }),
      sources: sources(),
      now: 1,
    });
    expect(result.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["host-offline", "sending-paused"]),
    );
    expect(result.items.find((item) => item.id === "sending-paused")?.target).toBe("Sending");
  });
});
