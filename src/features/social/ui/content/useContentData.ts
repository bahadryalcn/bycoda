import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";
import { appendSocialWorkspacePage, socialRows } from "../../model/socialWorkspace";
import type { SocialCampaign, SocialJob, SocialSnapshot } from "../../model/social";
import type { SocialProgram } from "../../model/socialProgram";
import { useFirstPageRefresh } from "../../hooks/useFirstPageRefresh";
import { refreshContentPages, type ContentPage, type Offsets } from "./contentRefresh";

/** Automatic refresh of the content list, programs and scheduled window while the screen is active. */
const CONTENT_REFRESH_MS = 30_000;

/** Advance each bounded collection independently; exhausted collections keep their last page. */
export function nextContentOffsets(snapshot?: SocialSnapshot): Offsets | undefined {
  const offsets: Offsets = {};
  let more = false;
  for (const collection of ["campaigns", "jobs"] as const) {
    const page = snapshot?.pages?.[collection];
    if (!page) continue;
    const next = page.offset + page.limit;
    const hasMore = next < page.total;
    offsets[collection] = hasMore ? next : page.offset;
    more ||= hasMore;
  }
  return more ? offsets : undefined;
}

export type ScheduledRange = { from: number; to: number };

const RANGE_PAGE = 100;
const RANGE_ATTEMPTS = 3;

/**
 * Every publish job scheduled in [from, to), whatever its creation date, with the campaigns they belong to.
 * The window is read page by page in schedule order; if the window's size changed while reading (a post was
 * added or moved), the pass restarts so no row is skipped or repeated. The last attempt is kept as is: the
 * screen refetches on its own interval and after each save.
 */
export async function loadScheduledJobs(
  client: SocialClient,
  projectId: string | undefined,
  range: ScheduledRange,
): Promise<{ jobs: SocialJob[]; campaigns: SocialCampaign[] }> {
  let result: { jobs: SocialJob[]; campaigns: SocialCampaign[] } = { jobs: [], campaigns: [] };
  for (let attempt = 0; attempt < RANGE_ATTEMPTS; attempt++) {
    const jobs: SocialJob[] = [];
    const campaigns: SocialCampaign[] = [];
    let offset = 0;
    let total = 0;
    let firstTotal: number | undefined;
    do {
      const { snapshot } = await client.sectionSnapshot({
        section: "campaigns",
        projectId,
        limit: RANGE_PAGE,
        offsets: { jobs: offset },
        filters: {
          jobs: { kind: "publish", scheduledFrom: range.from, scheduledTo: range.to },
        },
      });
      const page = snapshot?.pages?.jobs;
      if (!snapshot || !page) throw new Error("The Host did not return the scheduled posts.");
      total = page.total;
      firstTotal ??= total;
      jobs.push(...snapshot.jobs);
      campaigns.push(...socialRows(snapshot.campaigns, snapshot.related?.campaigns));
      offset += RANGE_PAGE;
    } while (offset < total);
    result = { jobs: socialRows(jobs), campaigns: socialRows(campaigns) };
    if (firstTotal === total) break;
  }
  return result;
}

/**
 * Campaigns and jobs reach the list view through bounded offset pages, newest first. The calendar views pass
 * the visible `range` instead and read the jobs scheduled in it. Hidden screens stop polling.
 */
export function useContentData(
  client: SocialClient,
  projectId: string | undefined,
  active: boolean,
  range?: ScheduledRange,
) {
  const cache = useQueryClient();
  const scope = [...socialQueryScope(client), "content"] as const;
  const snapshotKey = [...scope, "snapshot", projectId ?? ""];
  const readPage = async (offsets: Offsets): Promise<ContentPage> => ({
    snapshot: (
      await client.sectionSnapshot({
        section: "campaigns",
        projectId,
        limit: 100,
        offsets,
      })
    ).snapshot,
    offsets,
  });
  const snapshot = useInfiniteQuery({
    queryKey: snapshotKey,
    initialPageParam: {} as Offsets,
    queryFn: ({ pageParam }) => readPage(pageParam),
    getNextPageParam: (last) => nextContentOffsets(last.snapshot),
    enabled: active,
    // The newest-page poll below keeps the list current; only an invalidation makes it stale.
    staleTime: Infinity,
  });
  // Only the newest page is re-read, so loading more pages never makes a poll dearer.
  useFirstPageRefresh({
    active,
    queryKey: snapshotKey,
    intervalMs: CONTENT_REFRESH_MS,
    read: () => readPage({}),
    merge: refreshContentPages,
  });
  const programs = useQuery({
    queryKey: [...scope, "programs", projectId ?? ""],
    queryFn: () => client.request<SocialProgram[]>("programs.list", projectId ? { projectId } : {}),
    enabled: active,
    staleTime: 10_000,
    refetchInterval: active ? CONTENT_REFRESH_MS : false,
  });
  const scheduled = useQuery({
    queryKey: [...scope, "scheduled", projectId ?? "", range?.from ?? 0, range?.to ?? 0],
    queryFn: () => loadScheduledJobs(client, projectId, range!),
    enabled: active && !!range,
    staleTime: 10_000,
    refetchInterval: active ? CONTENT_REFRESH_MS : false,
    refetchOnMount: "always",
  });
  let combined: SocialSnapshot | undefined;
  for (const page of snapshot.data?.pages ?? []) {
    if (page.snapshot) combined = appendSocialWorkspacePage(combined, page.snapshot, page.offsets);
  }
  if (combined)
    combined = {
      ...combined,
      campaigns: socialRows(combined.campaigns, combined.related?.campaigns),
      jobs: socialRows(combined.jobs, combined.related?.jobs),
    };
  const loadMore = () => {
    if (snapshot.isFetching) return;
    void snapshot.fetchNextPage().catch(() => undefined);
  };
  return {
    snapshot: combined,
    programs: programs.data ?? [],
    loading: snapshot.isPending,
    /** Jobs scheduled in the requested `range`; empty until that window has loaded. */
    scheduledJobs: scheduled.data?.jobs ?? [],
    scheduledCampaigns: scheduled.data?.campaigns ?? [],
    scheduledLoading: !!range && scheduled.isPending,
    error:
      (snapshot.isFetchNextPageError ? undefined : snapshot.error) ??
      programs.error ??
      scheduled.error ??
      undefined,
    hasMore: snapshot.hasNextPage,
    loadingMore: snapshot.isFetchingNextPage,
    moreError: snapshot.isFetchNextPageError ? snapshot.error?.message : undefined,
    loadMore,
    refetch: () => {
      // Observers follow selection changes; a delayed save must invalidate its original keys.
      void cache
        .invalidateQueries({ queryKey: [...scope, "snapshot", projectId ?? ""], exact: true })
        .catch(() => undefined);
      void cache
        .invalidateQueries({ queryKey: [...scope, "programs", projectId ?? ""], exact: true })
        .catch(() => undefined);
      // Every range already visited for the project, not only the current one.
      void cache
        .invalidateQueries({ queryKey: [...scope, "scheduled", projectId ?? ""] })
        .catch(() => undefined);
    },
  };
}
