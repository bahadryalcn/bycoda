import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialJob, SocialSnapshot } from "./social";
import type { SocialClient } from "./socialClient";
import { readTodaySection } from "./socialTodayRead";
import { sectionFromFullSnapshot } from "./socialTodaySections";

const UNSUPPORTED = new Error("Unsupported social operation.");

const job = (id: string, over: Partial<SocialJob>): SocialJob =>
  ({
    id,
    accountId: "a1",
    projectIds: ["p1"],
    status: "queued",
    scheduledAt: 1,
    createdAt: Number(id.replace(/\D/g, "")) || 1,
    payload: { text: id, media: [] },
    ...over,
  }) as SocialJob;

/** A full Host snapshot holding two projects, as an older Host returns it. */
function fullSnapshot(): SocialSnapshot {
  return {
    executorId: "e1",
    hostOnline: true,
    sendingEnabled: true,
    stopped: false,
    pollingEnabled: true,
    accounts: [],
    capabilities: {},
    campaigns: [
      { id: "c1", name: "One", projectIds: ["p1"], paused: false, createdAt: 1 },
      { id: "c2", name: "Two", projectIds: ["p2"], paused: false, createdAt: 2 },
    ],
    approvedCampaignIds: ["c1", "c2"],
    publishingPlans: [],
    threads: [
      { id: "t1", projectId: "p1", contactId: "k1", lastInboundAt: 5 },
      { id: "t2", projectId: "p2", contactId: "k2", lastInboundAt: 6 },
      { id: "t3", contactId: "k1", lastInboundAt: 7 },
    ],
    contacts: [
      { id: "k1", projectIds: ["p1"] },
      { id: "k2", projectIds: ["p2"] },
    ],
    segments: [],
    rules: [{ id: "r1", projectId: "p1" }],
    jobs: [
      job("j1", { campaignId: "c1", status: "failed", error: "boom" }),
      job("j2", { campaignId: "c1", status: "queued" }),
      job("j3", { projectIds: ["p2"], campaignId: "c2", status: "failed" }),
      job("j4", { status: "review" }),
    ],
    drafts: [
      { id: "d1", projectId: "p1", contactId: "k1", threadId: "t1", createdAt: 1 },
      { id: "d2", projectId: "p2", contactId: "k2", createdAt: 2 },
    ],
    profiles: [{ projectId: "p1" }, { projectId: "p2" }],
  } as unknown as SocialSnapshot;
}

function fakeClient(options: { narrow: "unsupported" | "supported"; full?: SocialSnapshot }) {
  const sectionSnapshot = vi.fn(async (_input: unknown) => {
    if (options.narrow === "unsupported") throw UNSUPPORTED;
    const snapshot = { narrow: true } as unknown as SocialSnapshot;
    return { cursor: "x", unchanged: false, snapshot };
  });
  const snapshot = vi.fn(async () => options.full ?? fullSnapshot());
  const client = { sectionSnapshot, snapshot } as unknown as SocialClient;
  return { client, sectionSnapshot, snapshot };
}

afterEach(() => vi.restoreAllMocks());

describe("sectionFromFullSnapshot", () => {
  it("narrows a section to its collections and the selected project", () => {
    const result = sectionFromFullSnapshot(fullSnapshot(), "inbox", "p1", 50);
    expect(result.threads.map((row) => row.id)).toEqual(["t3", "t1"]);
    expect(result.contacts.map((row) => row.id)).toEqual(["k1"]);
    expect(result.drafts.map((row) => row.id)).toEqual(["d1"]);
    expect(result.jobs.map((row) => row.id)).toEqual(["j4", "j2", "j1"]);
    expect(result.campaigns).toEqual([]);
    expect(result.rules).toEqual([]);
    expect(result.profiles).toEqual([{ projectId: "p1" }]);
    expect(result.pages?.drafts?.total).toBe(1);
  });

  it("counts every visible job, not only the returned page", () => {
    const result = sectionFromFullSnapshot(fullSnapshot(), "history", "p1", 1);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobCounts).toMatchObject({ failed: 1, queued: 1, review: 1 });
    expect(result.pages?.jobs).toEqual({ offset: 0, limit: 1, total: 3 });
  });

  it("derives campaign states from the visible jobs and keeps only visible campaigns", () => {
    const result = sectionFromFullSnapshot(fullSnapshot(), "campaigns", "p1", 50);
    expect(result.campaigns.map((row) => row.id)).toEqual(["c1"]);
    expect(result.campaignStates).toEqual({ c1: "failed" });
    expect(result.approvedCampaignIds).toEqual(["c1"]);
  });

  it("does not narrow by project when none is selected", () => {
    const result = sectionFromFullSnapshot(fullSnapshot(), "campaigns", "", 50);
    expect(result.campaigns.map((row) => row.id)).toEqual(["c2", "c1"]);
    expect(result.jobs).toHaveLength(4);
  });
});

describe("readTodaySection", () => {
  it("keeps the narrow path on a Host with section reads", async () => {
    const { client, sectionSnapshot, snapshot } = fakeClient({ narrow: "supported" });
    const result = await readTodaySection(client, "inbox", "p1");
    expect(result).toEqual({ narrow: true });
    expect(sectionSnapshot).toHaveBeenCalledWith({ section: "inbox", limit: 50, projectId: "p1" });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("shares one full snapshot across the four sections and remembers the capability", async () => {
    const { client, sectionSnapshot, snapshot } = fakeClient({ narrow: "unsupported" });
    const sections = ["campaigns", "inbox", "plans", "history"] as const;
    const first = await Promise.all(sections.map((name) => readTodaySection(client, name, "p1")));
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(first[1].threads.map((row) => row.id)).toEqual(["t3", "t1"]);
    expect(first[3].jobCounts?.failed).toBe(1);

    sectionSnapshot.mockClear();
    await Promise.all(sections.map((name) => readTodaySection(client, name, "p1")));
    // The unsupported capability is remembered: no further narrow probes, still one shared read.
    expect(sectionSnapshot).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("does not share a snapshot between Hosts or reuse a finished read", async () => {
    const one = fakeClient({ narrow: "unsupported" });
    const two = fakeClient({ narrow: "unsupported" });
    await Promise.all([
      readTodaySection(one.client, "inbox", "p1"),
      readTodaySection(two.client, "inbox", "p1"),
    ]);
    expect(one.snapshot).toHaveBeenCalledTimes(1);
    expect(two.snapshot).toHaveBeenCalledTimes(1);
    await readTodaySection(one.client, "inbox", "p1");
    expect(one.snapshot).toHaveBeenCalledTimes(2);
  });

  it("probes again after the remembered capability expires", async () => {
    const { client, sectionSnapshot } = fakeClient({ narrow: "unsupported" });
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    await readTodaySection(client, "inbox", "p1");
    sectionSnapshot.mockClear();
    now.mockReturnValue(1_000 + 11 * 60_000);
    await readTodaySection(client, "inbox", "p1");
    expect(sectionSnapshot).toHaveBeenCalledTimes(1);
  });

  it("rethrows any other failure without falling back", async () => {
    const { client, snapshot, sectionSnapshot } = fakeClient({ narrow: "supported" });
    sectionSnapshot.mockRejectedValueOnce(new Error("Host is unreachable."));
    await expect(readTodaySection(client, "inbox", "p1")).rejects.toThrow("Host is unreachable.");
    expect(snapshot).not.toHaveBeenCalled();
  });
});
