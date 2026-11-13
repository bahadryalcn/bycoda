import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef } from "react";
import {
  cacheInboxContinuation,
  inboxItemKey,
  type InboxListResult,
  type InboxQuery,
} from "../model/githubTasks";
import { fetchJiraInboxPage } from "../model/jiraInboxPage";
import { rememberInboxItems } from "../model/inboxSeen";

/** A scroll requests one page. A replaced query snapshot cannot accept an older read. */
export function useJiraListContinuation(
  queryKey: QueryKey,
  projects: readonly { path: string }[],
  fetchQuery: InboxQuery,
  data: InboxListResult | undefined,
  enabled: boolean,
) {
  const client = useQueryClient();
  const pending = useRef(false);
  const mutation = useMutation({
    mutationFn: async (snapshot: InboxListResult) => {
      const token = snapshot.jiraPage?.token;
      if (!token || client.getQueryData(queryKey) !== snapshot) return;
      const before = client.getQueryState(queryKey);
      if (before?.fetchStatus === "fetching") return;
      const page = await fetchJiraInboxPage(fetchQuery, token);
      const after = client.getQueryState(queryKey);
      if (
        client.getQueryData(queryKey) !== snapshot ||
        after?.fetchStatus === "fetching" ||
        after?.dataUpdatedAt !== before?.dataUpdatedAt
      )
        return;
      const cursors = [...(snapshot.jiraPage?.cursors ?? []), token];
      if (page.jiraPage.token && cursors.includes(page.jiraPage.token))
        throw new Error("Jira returned a repeated issue page token");
      const merged = new Map(snapshot.items.map((item) => [inboxItemKey(item), item]));
      for (const item of page.items) {
        const key = inboxItemKey(item);
        if (!merged.has(key)) merged.set(key, item);
      }
      const next: InboxListResult = {
        ...snapshot,
        items: [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        jiraPage: {
          ...page.jiraPage,
          total: page.jiraPage.total ?? snapshot.jiraPage?.total,
          cursors,
        },
        limited: [
          ...(snapshot.limited ?? []).filter((provider) => provider !== "jira"),
          ...(page.jiraPage.token ? ["jira" as const] : []),
        ],
      };
      cacheInboxContinuation(projects, fetchQuery, next);
      client.setQueryData(queryKey, next);
      rememberInboxItems(
        page.items.map((item) => ({
          key: inboxItemKey(item),
          updatedAt: item.updatedAt,
          projectPath: item.projectPath,
        })),
      );
    },
    retry: false,
    onSettled: () => {
      pending.current = false;
    },
  });
  const error =
    mutation.isError && mutation.variables === data
      ? mutation.error instanceof Error
        ? mutation.error.message
        : String(mutation.error)
      : null;
  return {
    hasMore: !!data?.jiraPage?.token,
    total: data?.jiraPage?.total,
    loading: mutation.isPending,
    error,
    loadMore: () => {
      if (
        !enabled ||
        !data?.jiraPage?.token ||
        pending.current ||
        client.getQueryData(queryKey) !== data
      )
        return;
      pending.current = true;
      mutation.mutate(data);
    },
  };
}
