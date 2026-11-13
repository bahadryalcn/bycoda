// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import type { SocialSnapshot, SocialWorkspaceQuery } from "../../model/social";
import { nextContentOffsets, useContentData } from "./useContentData";

let root: Root;
let cache: QueryClient;
let state!: ReturnType<typeof useContentData>;
function Probe({
  client,
  projectId,
  active,
}: {
  client: SocialClient;
  projectId: string;
  active: boolean;
}) {
  state = useContentData(client, projectId, active);
  return null;
}
function render(client: SocialClient, projectId = "p1", active = true) {
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(Probe, { client, projectId, active }),
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
