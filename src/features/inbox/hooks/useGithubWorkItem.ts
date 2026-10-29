import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { LinkedWorkItem } from "../../sessions/model/session";
import {
  githubWorkItem,
  GITHUB_WORK_ITEM_FRESH_MS,
  peekGithubWorkItem,
  type GithubWorkItem,
  type InboxItem,
} from "../model/githubTasks";

const asInboxItem = (item: GithubWorkItem, cwd: string): InboxItem => ({
  ...item,
  projectPath: cwd,
  provider: "github",
});

/**
 * One exact GitHub work item for a linked target, shared by every consumer of the
 * same target (the Inbox reveal lookup and the linked work item panel) through a
 * single query. The model's peek cache seeds it, so a cached item is shown without
 * a loading state while it revalidates; a failed read reports `error` beside it.
 */
export function useGithubWorkItem(
  target: Pick<LinkedWorkItem, "repo" | "kind" | "number"> | null,
  cwd: string,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const queryKey = [
    "inbox",
    "githubWorkItem",
    cwd,
    target?.repo ?? "",
    target?.kind ?? "",
    target?.number ?? 0,
  ] as const;
  const query = useQuery<InboxItem>({
    queryKey,
    queryFn: async () =>
      asInboxItem(
        await githubWorkItem(cwd, target!.repo, target!.kind, target!.number, {
          maxAgeMs: GITHUB_WORK_ITEM_FRESH_MS,
        }),
        cwd,
      ),
    initialData: () => {
      const cached = target
        ? peekGithubWorkItem(target.repo, target.kind, target.number, cwd)
        : null;
      return cached ? asInboxItem(cached, cwd) : undefined;
    },
    enabled: enabled && target != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  /** Replaces the shown item, for example after an action changed it. */
  const setItem = useStableCallback((next: InboxItem) => {
    queryClient.setQueryData(queryKey, next);
  });
  const error = query.error;
  return {
    item: target ? (query.data ?? null) : null,
    loading: target != null && query.isPending,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    setItem,
  };
}
