import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import {
  githubPrDiff,
  GITHUB_WORK_ITEM_FRESH_MS,
  githubWorkItemDetails,
  githubWorkItemThread,
  peekGithubPrDiff,
  peekGithubWorkItemDetails,
  peekGithubWorkItemThread,
  type GithubPrDiff,
  type GithubWorkItemDetails,
  type GithubWorkItemThread,
  type InboxItem,
} from "../model/githubTasks";
import {
  linearIssueDetails,
  linearIssueThread,
  peekLinearIssueDetails,
  peekLinearIssueThread,
  type LinearIssueThread,
} from "../model/linear";
import {
  jiraIssueDetails,
  jiraIssueThread,
  peekJiraIssueDetails,
  peekJiraIssueThread,
  type JiraIssueThread,
} from "../model/jira";
import {
  gitlabMrDiff,
  gitlabWorkItemDetails,
  gitlabWorkItemThread,
  peekGitlabMrDiff,
  peekGitlabWorkItemDetails,
  peekGitlabWorkItemThread,
  type GitlabWorkItemThread,
} from "../model/gitlab";
import {
  azureDevOpsMrDiff,
  azureDevOpsWorkItemDetails,
  azureDevOpsWorkItemThread,
  peekAzureDevOpsMrDiff,
  peekAzureDevOpsWorkItemDetails,
  peekAzureDevOpsWorkItemThread,
  type AzureDevOpsWorkItemThread,
} from "../model/azureDevOps";

type ThreadData =
  | GithubWorkItemThread
  | LinearIssueThread
  | JiraIssueThread
  | GitlabWorkItemThread
  | AzureDevOpsWorkItemThread;

type DetailReaders = {
  peekDetails: () => GithubWorkItemDetails | null;
  fetchDetails: (maxAgeMs: number | undefined) => Promise<GithubWorkItemDetails>;
  peekThread: () => ThreadData | null;
  /** Null when this item kind has no discussion thread to read. */
  fetchThread: ((maxAgeMs: number | undefined) => Promise<ThreadData>) | null;
};

/** Provider dispatch for the work item reads; one entry per provider/kind. */
function detailReaders(item: InboxItem): DetailReaders {
  const { repo, number, projectPath } = item;
  switch (item.provider) {
    case "linear": {
      const id = item.id ?? "";
      return {
        peekDetails: () => peekLinearIssueDetails(id),
        fetchDetails: () =>
          id ? linearIssueDetails(id) : Promise.reject(new Error("Missing Linear issue")),
        peekThread: () => peekLinearIssueThread(id),
        fetchThread: () => linearIssueThread(id),
      };
    }
    case "jira": {
      const key = item.identifier ?? "";
      return {
        peekDetails: () => peekJiraIssueDetails(key),
        fetchDetails: () =>
          key ? jiraIssueDetails(key) : Promise.reject(new Error("Missing Jira issue")),
        peekThread: () => peekJiraIssueThread(key),
        fetchThread: () => jiraIssueThread(key),
      };
    }
    case "gitlab":
      if (item.kind === "issue" || item.kind === "pr") {
        const kind = item.kind;
        return {
          peekDetails: () => peekGitlabWorkItemDetails(repo, kind, number),
          fetchDetails: () => gitlabWorkItemDetails(repo, kind, number),
          peekThread: () => peekGitlabWorkItemThread(repo, kind, number),
          fetchThread: () => gitlabWorkItemThread(repo, kind, number),
        };
      }
      break;
    case "azuredevops":
      if (item.kind === "issue" || item.kind === "pr") {
        const kind = item.kind;
        return {
          peekDetails: () => peekAzureDevOpsWorkItemDetails(repo, kind, number),
          fetchDetails: () => azureDevOpsWorkItemDetails(repo, kind, number),
          peekThread: () => peekAzureDevOpsWorkItemThread(repo, kind, number),
          fetchThread: () => azureDevOpsWorkItemThread(repo, kind, number),
        };
      }
      break;
    case "github":
      if (item.kind === "issue" || item.kind === "pr") {
        const kind = item.kind;
        return {
          peekDetails: () => peekGithubWorkItemDetails(repo, kind, number, projectPath),
          fetchDetails: (maxAgeMs) =>
            githubWorkItemDetails(projectPath, repo, kind, number, { maxAgeMs }),
          peekThread: () => peekGithubWorkItemThread(repo, kind, number, projectPath),
          fetchThread: (maxAgeMs) =>
            githubWorkItemThread(projectPath, repo, kind, number, { maxAgeMs }),
        };
      }
      break;
  }
  return {
    peekDetails: () => null,
    fetchDetails: () => Promise.reject(new Error("Unknown inbox item")),
    peekThread: () => null,
    fetchThread: null,
  };
}

const errorMessage = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/**
 * Every read is a query keyed by the item identity, its list revision and the
 * reuse window, so a newer revision or another item starts a fresh read and an
 * older in-flight answer lands in a query nobody observes. The model's peek
 * cache seeds each query, which keeps a cached answer on screen (not loading)
 * while it revalidates; a failed revalidation reports its error next to that
 * answer. Queries are dropped when unobserved so a reopened panel re-seeds from
 * the freshest peek.
 */
export function useInboxDetailData(
  item: InboxItem,
  revision: number,
  tab: "summary" | "code" | "checks",
  fullFile: boolean,
  panel = false,
) {
  const queryClient = useQueryClient();
  const initialUpdatedAt = useRef(item.updatedAt);
  // A newer list revision invalidates the panel's initially reusable detail cache.
  const maxAgeMs =
    panel && revision === 0 && item.updatedAt === initialUpdatedAt.current
      ? GITHUB_WORK_ITEM_FRESH_MS
      : undefined;
  const diffWanted = tab === "code" || (panel && tab === "summary");
  const linear = item.provider === "linear";
  const jira = item.provider === "jira";
  const tracker = linear || jira;
  const jiraKey = jira ? (item.identifier ?? "") : "";
  const gitlab = item.provider === "gitlab";
  const azuredevops = item.provider === "azuredevops";
  const isPr = !tracker && item.kind === "pr";
  const githubKind =
    item.provider === "github" && (item.kind === "issue" || item.kind === "pr") ? item.kind : null;
  const gitlabKind = gitlab && (item.kind === "issue" || item.kind === "pr") ? item.kind : null;
  const azureDevOpsKind =
    azuredevops && (item.kind === "issue" || item.kind === "pr") ? item.kind : null;
  const readers = detailReaders(item);
  const identity = [
    item.provider,
    item.kind,
    item.repo,
    item.number,
    item.projectPath,
    item.id ?? "",
    item.identifier ?? "",
    item.updatedAt,
    revision,
    maxAgeMs ?? null,
  ] as const;
  const common = {
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } as const;

  const detailsQuery = useQuery<GithubWorkItemDetails>({
    ...common,
    queryKey: ["inbox", "detail", "details", ...identity],
    queryFn: () => readers.fetchDetails(maxAgeMs),
    initialData: () => readers.peekDetails() ?? undefined,
  });
  const threadKey = ["inbox", "detail", "thread", ...identity] as const;
  const threadQuery = useQuery<ThreadData>({
    ...common,
    queryKey: threadKey,
    queryFn: () => readers.fetchThread!(maxAgeMs),
    initialData: () => readers.peekThread() ?? undefined,
    enabled: readers.fetchThread != null,
  });
  const diffQuery = useQuery<GithubPrDiff>({
    ...common,
    queryKey: [
      "inbox",
      "detail",
      "diff",
      item.provider,
      item.repo,
      item.number,
      item.projectPath,
      fullFile,
      item.updatedAt,
      revision,
      maxAgeMs ?? null,
    ],
    queryFn: () =>
      gitlab
        ? gitlabMrDiff(item.repo, item.number)
        : azuredevops
          ? azureDevOpsMrDiff(item.repo, item.number)
          : githubPrDiff(item.projectPath, item.repo, item.number, {
              fullContext: fullFile,
              maxAgeMs,
            }),
    initialData: () =>
      (gitlab
        ? peekGitlabMrDiff(item.repo, item.number)
        : azuredevops
          ? peekAzureDevOpsMrDiff(item.repo, item.number)
          : peekGithubPrDiff(item.repo, item.number, fullFile, item.projectPath)) ?? undefined,
    enabled: isPr && diffWanted,
  });

  /** Replaces the shown thread, for example with a freshly forced read after posting. */
  const setThread = useStableCallback((next: ThreadData) => {
    queryClient.setQueryData(threadKey, next);
  });

  return {
    linear,
    jira,
    tracker,
    jiraKey,
    gitlab,
    azuredevops,
    isPr,
    githubKind,
    gitlabKind,
    azureDevOpsKind,
    details: detailsQuery.data ?? null,
    loading: detailsQuery.isPending,
    error: detailsQuery.error ? errorMessage(detailsQuery.error) : null,
    prDiff: isPr ? (diffQuery.data ?? null) : null,
    diffLoading: isPr && diffQuery.isPending,
    diffError: isPr && diffQuery.error ? errorMessage(diffQuery.error) : null,
    thread: threadQuery.data ?? null,
    setThread,
    threadLoading: threadQuery.isPending,
    threadError: threadQuery.error ? errorMessage(threadQuery.error) : null,
  };
}
