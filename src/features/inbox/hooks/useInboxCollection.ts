import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { INBOX_VISIBLE_POLL_MS } from "../model/inboxPolling";
import { rememberInboxItems } from "../model/inboxSeen";
import {
  inboxItemKey,
  inboxListFetchedAt,
  listInboxItems,
  peekInboxList,
  type InboxItem,
  type InboxListResult,
  type InboxProvider,
  type InboxProviderErrors,
  type InboxQuery,
} from "../model/githubTasks";

const NO_ITEMS: InboxItem[] = [];
const NO_ERRORS: InboxProviderErrors = {};

/** Shares fetched activity with the rail menu and background poll as reads settle. */
function rememberItems(items: readonly InboxItem[]) {
  rememberInboxItems(
    items.map((item) => ({
      key: inboxItemKey(item),
      updatedAt: item.updatedAt,
      projectPath: item.projectPath,
    })),
  );
}

type InboxCollectionOptions = {
  projects: readonly { path: string }[];
  fetchQuery: InboxQuery;
  /** Whether the surface is visible; hidden surfaces neither read nor poll. */
  enabled: boolean;
  /** False pauses the visible poll (for example Jira with background sync off). */
  automaticRefresh: boolean;
  /** Bumps force a read of the current scope, bypassing the fresh-cache skip. */
  refresh: number;
  /** Called once the read started by the newest `refresh` value has settled. */
  onRefreshSettled: () => void;
};

/**
 * Owns the Inbox list for the current project/provider/filter scope.
 *
 * The TanStack Query entry for that scope is the only copy of the collection:
 * items, per-provider errors and loading are derived from it, so a scope change
 * can never be undone by a mirrored snapshot of the previous scope. Item
 * mutations patch the query cache of the scope that produced the item (and the
 * current scope when it differs), never a key captured at mount.
 */
export function useInboxCollection({
  projects,
  fetchQuery,
  enabled,
  automaticRefresh,
  refresh,
  onRefreshSettled,
}: InboxCollectionOptions) {
  const queryClient = useQueryClient();
  const forceRead = useRef(false);
  const retryFailedRead = useRef(false);
  const queryKey = useMemo(
    () => ["inbox", "list", projects, fetchQuery] as const,
    [projects, fetchQuery],
  );
  const currentQueryKey = useRef(queryKey);
  useLayoutEffect(() => {
    currentQueryKey.current = queryKey;
  }, [queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const force = forceRead.current;
      forceRead.current = false;
      const retryFailedOnly = retryFailedRead.current;
      retryFailedRead.current = false;
      const cached = peekInboxList(projects, fetchQuery);
      try {
        const result = await listInboxItems(projects, fetchQuery, {
          force,
          retryFailedOnly,
          onProgress: (progress) => {
            if (signal.aborted) return;
            queryClient.setQueryData(queryKey, progress);
            rememberItems(progress.items);
          },
        });
        rememberItems(result.items);
        return result;
      } catch (reason) {
        if (cached) return cached;
        const message = reason instanceof Error ? reason.message : String(reason);
        return {
          items: [] as InboxItem[],
          errors: {
            github: message,
            linear: message,
            jira: message,
            gitlab: message,
            azuredevops: message,
          },
        };
      }
    },
    initialData: () => peekInboxList(projects, fetchQuery) ?? undefined,
    initialDataUpdatedAt: () => inboxListFetchedAt(projects, fetchQuery),
    // Reopening checks the shared cache's real age, including background reads.
    // listInboxItems skips provider calls while that cache is still fresh.
    refetchOnMount: "always",
    enabled,
    staleTime: INBOX_VISIBLE_POLL_MS,
    refetchInterval: (current) => {
      if (!automaticRefresh) return false;
      // A cached read on entry must not start another full five-minute wait.
      // Failed reads use the regular interval rather than a tight retry loop.
      if (Object.keys(current.state.data?.errors ?? {}).length > 0) return INBOX_VISIBLE_POLL_MS;
      const fetchedAt = inboxListFetchedAt(projects, fetchQuery);
      return fetchedAt
        ? Math.max(1000, fetchedAt + INBOX_VISIBLE_POLL_MS - Date.now())
        : INBOX_VISIBLE_POLL_MS;
    },
    retry: false,
  });

  const settled = useStableCallback(onRefreshSettled);
  const previousRefresh = useRef(refresh);
  useEffect(() => {
    if (refresh === previousRefresh.current) return;
    previousRefresh.current = refresh;
    forceRead.current = true;
    void queryClient.invalidateQueries({ queryKey }).finally(() => {
      if (previousRefresh.current === refresh) settled();
    });
  }, [refresh, queryKey, queryClient, settled]);

  /**
   * Replaces one item (matched by provider identity) in the collection. The
   * callback is bound to the scope it was created for, so an async detail
   * action that finishes after a scope change still patches the list that
   * produced the item; the current scope is patched too when it differs.
   */
  const updateItem = useCallback(
    (next: InboxItem) => {
      const key = inboxItemKey(next);
      const patch = (current: InboxListResult | undefined) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) => (inboxItemKey(entry) === key ? next : entry)),
            }
          : current;
      for (const target of new Set([queryKey, currentQueryKey.current])) {
        queryClient.setQueryData<InboxListResult>(target, patch);
      }
      rememberItems([next]);
    },
    [queryClient, queryKey],
  );

  const setRetryFailedOnly = useCallback((value: boolean) => {
    retryFailedRead.current = value;
  }, []);

  const data = query.data;
  return {
    items: data?.items ?? NO_ITEMS,
    providerErrors: data?.errors ?? NO_ERRORS,
    limited: (data?.limited ?? null) as readonly InboxProvider[] | null,
    loading: query.isPending,
    updateItem,
    setRetryFailedOnly,
  };
}
