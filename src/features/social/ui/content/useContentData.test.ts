// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import type { SocialSnapshot, SocialWorkspaceQuery } from "../../model/social";
import { nextContentOffsets, useContentData, type ScheduledRange } from "./useContentData";

let root: Root;
let cache: QueryClient;
let state!: ReturnType<typeof useContentData>;
function Probe({
  client,
  projectId,
  active,
  range,
}: {
  client: SocialClient;
  projectId: string;
  active: boolean;
  range?: ScheduledRange;
}) {
  state = useContentData(client, projectId, active, range);
  return null;
}
function render(client: SocialClient, projectId = "p1", active = true, range?: ScheduledRange) {
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(Probe, { client, projectId, active, range }),
      ),
    ),
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function page(
  campaignOffset: number,
  jobOffset: number,
  campaignTotal = 102,
  jobTotal = 101,
): SocialSnapshot {
  return {
    campaigns: Array.from(
      { length: Math.min(100, campaignTotal - campaignOffset) },
      (_, index) => ({ id: `c${campaignOffset + index}` }),
    ),
    jobs: Array.from({ length: Math.min(100, jobTotal - jobOffset) }, (_, index) => ({
      id: `j${jobOffset + index}`,
    })),
    accounts: [],
    related: { campaigns: [{ id: "related-campaign" }], jobs: [] },
    pages: {
      campaigns: { offset: campaignOffset, limit: 100, total: campaignTotal },
      jobs: { offset: jobOffset, limit: 100, total: jobTotal },
    },
  } as unknown as SocialSnapshot;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  cache.clear();
  vi.unstubAllGlobals();
});

it("keeps campaigns and jobs beyond the first 100 reachable with independent bounded offsets", async () => {
  const sectionSnapshot = vi.fn(async (input: SocialWorkspaceQuery) => ({
    snapshot: page(input.offsets?.campaigns ?? 0, input.offsets?.jobs ?? 0),
  }));
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client);
  await settle();
  expect(state.snapshot?.campaigns).toHaveLength(101); // Includes the job's related campaign.
  expect(state.hasMore).toBe(true);
  act(() => state.loadMore());
  await settle();
  expect(sectionSnapshot).toHaveBeenLastCalledWith({
    section: "campaigns",
    projectId: "p1",
    limit: 100,
    offsets: { campaigns: 100, jobs: 100 },
  });
  expect(state.snapshot?.campaigns.map((item) => item.id)).toContain("c101");
  expect(state.snapshot?.jobs.map((item) => item.id)).toContain("j100");
  expect(state.snapshot?.campaigns).toHaveLength(103);
  expect(state.hasMore).toBe(false);
});

it("continues jobs after the campaign page is exhausted without skipping its first page", () => {
  expect(nextContentOffsets(page(0, 0, 2, 201))).toEqual({ campaigns: 0, jobs: 100 });
  expect(nextContentOffsets(page(0, 100, 2, 201))).toEqual({ campaigns: 0, jobs: 200 });
  expect(nextContentOffsets(page(0, 200, 2, 201))).toBeUndefined();
  expect(nextContentOffsets()).toBeUndefined();
});

it("preserves loaded records on continuation failure and retries that page", async () => {
  const sectionSnapshot = vi
    .fn()
    .mockResolvedValueOnce({ snapshot: page(0, 0) })
    .mockRejectedValueOnce(new Error("Older page offline"))
    .mockResolvedValueOnce({ snapshot: page(100, 100) });
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client);
  await settle();
  act(() => state.loadMore());
  await settle();
  expect(state.error).toBeUndefined();
  expect(state.moreError).toBe("Older page offline");
  expect(state.snapshot?.jobs).toHaveLength(100);
  act(() => state.loadMore());
  await settle();
  expect(state.snapshot?.jobs).toHaveLength(101);
  expect(state.moreError).toBeUndefined();
});

it("isolates both Host and project query pages, and does not read hidden screens", async () => {
  const sectionSnapshot = vi.fn(async () => ({ snapshot: page(0, 0) }));
  const request = vi.fn(async () => []);
  const client = { sectionSnapshot, request } as unknown as SocialClient;
  render(client, "p1", false);
  await settle();
  expect(sectionSnapshot).not.toHaveBeenCalled();
  render(client);
  await settle();
  render(client, "p2");
  await settle();
  expect(sectionSnapshot).toHaveBeenLastCalledWith(
    expect.objectContaining({ projectId: "p2", offsets: {} }),
  );
  const other = {
    sectionSnapshot: vi.fn(async () => ({ snapshot: page(0, 0, 1, 1) })),
    request,
  } as unknown as SocialClient;
  render(other, "p2");
  await settle();
  expect(state.snapshot?.jobs).toHaveLength(1);
});

it("refreshes the original project after a delayed save, without refreshing the newly selected project", async () => {
  const sectionSnapshot = vi.fn(async () => ({ snapshot: page(0, 0, 1, 1) }));
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client);
  await settle();
  const savedInOriginalProject = state.refetch;
  render(client, "p2");
  await settle();
  act(() => savedInOriginalProject());
  await settle();
  expect(sectionSnapshot).toHaveBeenCalledTimes(2);
  render(client);
  await settle();
  expect(sectionSnapshot).toHaveBeenCalledTimes(3);
  expect(sectionSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "p1" }));
});

/** One page of the jobs scheduled in a range: `total` rows in schedule order, `id` s0, s1, … */
function rangePage(input: SocialWorkspaceQuery, total: number, prefix = "s"): SocialSnapshot {
  const offset = input.offsets?.jobs ?? 0;
  return {
    campaigns: [],
    jobs: Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, index) => ({
      id: `${prefix}${offset + index}`,
      kind: "publish",
      campaignId: "far-campaign",
    })),
    accounts: [],
    related: { campaigns: [{ id: "far-campaign" }], jobs: [] },
    pages: {
      campaigns: { offset: 0, limit: 100, total: 0 },
      jobs: { offset, limit: 100, total },
    },
  } as unknown as SocialSnapshot;
}
const range = { from: 1_000, to: 2_000 };

it("asks the Host for the jobs scheduled in the visible range and reads every page of it", async () => {
  const sectionSnapshot = vi.fn(async (input: SocialWorkspaceQuery) => ({
    snapshot: input.filters?.jobs ? rangePage(input, 150) : page(0, 0, 1, 1),
  }));
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client, "p1", true, range);
  await settle();
  const filters = { jobs: { kind: "publish", scheduledFrom: 1_000, scheduledTo: 2_000 } };
  expect(sectionSnapshot).toHaveBeenCalledWith({
    section: "campaigns",
    projectId: "p1",
    limit: 100,
    offsets: { jobs: 0 },
    filters,
  });
  expect(sectionSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ offsets: { jobs: 100 }, filters }),
  );
  expect(state.scheduledJobs.map((job) => job.id)).toEqual(
    Array.from({ length: 150 }, (_, index) => `s${index}`),
  );
  expect(state.scheduledCampaigns.map((campaign) => campaign.id)).toEqual(["far-campaign"]);
  expect(state.scheduledLoading).toBe(false);
});

it("never sends a schedule filter when no range is asked for, so the list keeps its newest-first pages", async () => {
  const sectionSnapshot = vi.fn(async () => ({ snapshot: page(0, 0) }));
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client);
  await settle();
  expect(sectionSnapshot).toHaveBeenCalledTimes(1);
  expect(sectionSnapshot).toHaveBeenCalledWith({
    section: "campaigns",
    projectId: "p1",
    limit: 100,
    offsets: {},
  });
  expect(state.scheduledJobs).toEqual([]);
  expect(state.scheduledLoading).toBe(false);
});

it("reads the new range when the calendar moves and keeps ranges, projects and Hosts apart", async () => {
  const sectionSnapshot = vi.fn(async (input: SocialWorkspaceQuery) => ({
    snapshot: input.filters?.jobs
      ? rangePage(input, 1, `${input.projectId}-${input.filters.jobs.scheduledFrom}-`)
      : page(0, 0, 1, 1),
  }));
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client, "p1", true, range);
  await settle();
  expect(state.scheduledJobs.map((job) => job.id)).toEqual(["p1-1000-0"]);
  render(client, "p1", true, { from: 2_000, to: 3_000 });
  expect(state.scheduledLoading).toBe(true);
  expect(state.scheduledJobs).toEqual([]);
  await settle();
  expect(state.scheduledJobs.map((job) => job.id)).toEqual(["p1-2000-0"]);
  render(client, "p2", true, range);
  await settle();
  expect(state.scheduledJobs.map((job) => job.id)).toEqual(["p2-1000-0"]);
  const other = {
    sectionSnapshot: vi.fn(async (input: SocialWorkspaceQuery) => ({
      snapshot: input.filters?.jobs ? rangePage(input, 1, "other-") : page(0, 0, 1, 1),
    })),
    request: vi.fn(async () => []),
  } as unknown as SocialClient;
  render(other, "p2", true, range);
  await settle();
  expect(state.scheduledJobs.map((job) => job.id)).toEqual(["other-0"]);
});

it("restarts a range read whose size changed mid-way, so no job is skipped or repeated", async () => {
  const sectionSnapshot = vi.fn(async (input: SocialWorkspaceQuery) => {
    if (!input.filters?.jobs) return { snapshot: page(0, 0, 1, 1) };
    const call = sectionSnapshot.mock.calls.filter(([item]) => item.filters?.jobs).length;
    // The first pass sees 101 rows, then a post is added before its second page: 102.
    return { snapshot: rangePage(input, call === 1 ? 101 : 102) };
  });
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client, "p1", true, range);
  await settle();
  const rangeCalls = sectionSnapshot.mock.calls.filter(([input]) => input.filters?.jobs);
  expect(rangeCalls.map(([input]) => input.offsets?.jobs)).toEqual([0, 100, 0, 100]);
  expect(state.scheduledJobs).toHaveLength(102);
  expect(new Set(state.scheduledJobs.map((job) => job.id)).size).toBe(102);
});

it("shows the range error with the screen's retry, and a refetch reloads every visited range", async () => {
  const sectionSnapshot = vi
    .fn()
    .mockResolvedValueOnce({ snapshot: page(0, 0, 1, 1) })
    .mockRejectedValueOnce(new Error("Range offline"))
    .mockResolvedValue({ snapshot: rangePage({}, 1) });
  const client = { sectionSnapshot, request: vi.fn(async () => []) } as unknown as SocialClient;
  render(client, "p1", true, range);
  await settle();
  expect((state.error as Error).message).toBe("Range offline");
  act(() => state.refetch());
  await settle();
  expect(state.error).toBeUndefined();
  expect(state.scheduledJobs.map((job) => job.id)).toEqual(["s0"]);
});
