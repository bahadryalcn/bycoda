import { useQueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { usePollingRefresh } from "./usePollingRefresh";

export type FirstPageRefreshOptions<Page, Param> = {
  /** False while the screen is hidden or its list is not meant to poll: nothing is read. */
  active: boolean;
  /** Key of the infinite query whose newest page is refreshed. */
  queryKey: QueryKey;
  intervalMs: number;
  /** Reads the newest page only, with the same request the query uses for its first page. */
  read: () => Promise<Page>;
  /** Folds the fresh newest page into the loaded pages without dropping them or their cursors. */
  merge: (data: InfiniteData<Page, Param>, fresh: Page) => InfiniteData<Page, Param>;
};

/**
 * Keeps an infinite list current by re-reading only its newest page. React Query's own interval
 * re-requests every loaded page, so each "Load more" would make every later poll more expensive.
 * The refreshed page is written into the cache only while the query is idle, unchanged since the
 * read began and still the one this poll was started for; an explicit refetch, a load-more or a
 * key change in the meantime wins and the stale read is dropped. Data loaded less than half an
 * interval ago is not read again. The query that owns the list
 * should use `staleTime: Infinity` while this runs, so only an invalidation refetches every page.
 */
export function useFirstPageRefresh<Page, Param>({
  active,
  queryKey,
  intervalMs,
  read,
  merge,
}: FirstPageRefreshOptions<Page, Param>) {
  const cache = useQueryClient();
  usePollingRefresh({
    active,
    // A new Host, project, account or filter restarts the poll and fences reads still running.
    scope: JSON.stringify(queryKey),
    intervalMs,
    load: async (isCurrent) => {
      const before = cache.getQueryState<InfiniteData<Page, Param>>(queryKey);
      // Nothing loaded yet, or another read (first load, load-more, refetch) is already in flight or
      // invalidated the list: that read brings the newest rows itself.
      if (!before?.data || before.fetchStatus !== "idle" || before.isInvalidated) return;
      // The list was just loaded (or the poll only just started): reading again would repeat it.
      if (Date.now() - before.dataUpdatedAt < intervalMs / 2) return;
      const fresh = await read();
      const after = cache.getQueryState<InfiniteData<Page, Param>>(queryKey);
      if (
        !isCurrent() ||
        !after?.data ||
        after.fetchStatus !== "idle" ||
        after.isInvalidated ||
        after.dataUpdatedAt !== before.dataUpdatedAt
      )
        return;
      cache.setQueryData<InfiniteData<Page, Param>>(queryKey, (old) =>
        old ? merge(old, fresh) : old,
      );
    },
  });
}
