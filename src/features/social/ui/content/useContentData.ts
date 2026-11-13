import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";
import { appendSocialWorkspacePage, socialRows } from "../../model/socialWorkspace";
import type { SocialSnapshot, SocialWorkspaceQuery } from "../../model/social";
import type { SocialProgram } from "../../model/socialProgram";

type Offsets = NonNullable<SocialWorkspaceQuery["offsets"]>;

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

/** Bounded Host pages remain reachable in both calendar and list views. Hidden screens stop polling. */
export function useContentData(
  client: SocialClient,
  projectId: string | undefined,
  active: boolean,
) {
  const cache = useQueryClient();
  const scope = [...socialQueryScope(client), "content"] as const;
  const snapshot = useInfiniteQuery({
    queryKey: [...scope, "snapshot", projectId ?? ""],
    initialPageParam: {} as Offsets,
    queryFn: async ({ pageParam }) => ({
      snapshot: (
        await client.sectionSnapshot({
          section: "campaigns",
          projectId,
          limit: 100,
          offsets: pageParam,
        })
      ).snapshot,
      offsets: pageParam,
    }),
    getNextPageParam: (last) => nextContentOffsets(last.snapshot),
    enabled: active,
    staleTime: 10_000,
    refetchInterval: active ? 30_000 : false,
    refetchOnMount: "always",
  });
  const programs = useQuery({
    queryKey: [...scope, "programs", projectId ?? ""],
    queryFn: () => client.request<SocialProgram[]>("programs.list", projectId ? { projectId } : {}),
    enabled: active,
    staleTime: 10_000,
    refetchInterval: active ? 30_000 : false,
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
    error:
      (snapshot.isFetchNextPageError ? undefined : snapshot.error) ?? programs.error ?? undefined,
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
    },
  };
}
