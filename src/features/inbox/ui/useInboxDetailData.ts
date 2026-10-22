import { useEffect, useRef, useState } from "react";
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

export function useInboxDetailData(
  item: InboxItem,
  revision: number,
  tab: "summary" | "code" | "checks",
  fullFile: boolean,
  panel = false,
) {
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
  const cached = linear
    ? peekLinearIssueDetails(item.id ?? "")
    : jira
      ? peekJiraIssueDetails(jiraKey)
      : gitlabKind
        ? peekGitlabWorkItemDetails(item.repo, gitlabKind, item.number)
        : azureDevOpsKind
          ? peekAzureDevOpsWorkItemDetails(item.repo, azureDevOpsKind, item.number)
          : githubKind
            ? peekGithubWorkItemDetails(item.repo, githubKind, item.number, item.projectPath)
            : null;
  const cachedDiff = isPr
    ? gitlab
      ? peekGitlabMrDiff(item.repo, item.number)
      : azuredevops
        ? peekAzureDevOpsMrDiff(item.repo, item.number)
        : peekGithubPrDiff(item.repo, item.number, false, item.projectPath)
    : null;
  const cachedThread = linear
    ? peekLinearIssueThread(item.id ?? "")
    : jira
      ? peekJiraIssueThread(jiraKey)
      : gitlabKind
        ? peekGitlabWorkItemThread(item.repo, gitlabKind, item.number)
        : azureDevOpsKind
          ? peekAzureDevOpsWorkItemThread(item.repo, azureDevOpsKind, item.number)
          : githubKind
            ? peekGithubWorkItemThread(item.repo, githubKind, item.number, item.projectPath)
            : null;
  const [details, setDetails] = useState<GithubWorkItemDetails | null>(cached);
  const [loading, setLoading] = useState(cached == null);
  const [error, setError] = useState<string | null>(null);
  const [prDiff, setPrDiff] = useState<GithubPrDiff | null>(cachedDiff);
  const [diffLoading, setDiffLoading] = useState(isPr && cachedDiff == null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [thread, setThread] = useState<
    | GithubWorkItemThread
    | LinearIssueThread
    | JiraIssueThread
    | GitlabWorkItemThread
    | AzureDevOpsWorkItemThread
    | null
  >(cachedThread);
  const [threadLoading, setThreadLoading] = useState(cachedThread == null);
  const [threadError, setThreadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const cachedDetails = linear
      ? peekLinearIssueDetails(item.id ?? "")
      : jira
        ? peekJiraIssueDetails(jiraKey)
        : gitlabKind
          ? peekGitlabWorkItemDetails(item.repo, gitlabKind, item.number)
          : azureDevOpsKind
            ? peekAzureDevOpsWorkItemDetails(item.repo, azureDevOpsKind, item.number)
            : githubKind
              ? peekGithubWorkItemDetails(item.repo, githubKind, item.number, item.projectPath)
              : null;
    if (cachedDetails) {
      setDetails(cachedDetails);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
      setDetails(null);
    }
    const pending = linear
      ? item.id
        ? linearIssueDetails(item.id)
        : Promise.reject(new Error("Missing Linear issue"))
      : jira
        ? jiraKey
          ? jiraIssueDetails(jiraKey)
          : Promise.reject(new Error("Missing Jira issue"))
        : gitlabKind
          ? gitlabWorkItemDetails(item.repo, gitlabKind, item.number)
          : azureDevOpsKind
            ? azureDevOpsWorkItemDetails(item.repo, azureDevOpsKind, item.number)
            : githubKind
              ? githubWorkItemDetails(item.projectPath, item.repo, githubKind, item.number, {
                  maxAgeMs,
                })
              : Promise.reject(new Error("Unknown inbox item"));
    void pending
      .then((next) => {
        if (cancelled) return;
        setDetails(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    azureDevOpsKind,
    githubKind,
    gitlabKind,
    item.id,
    item.number,
    item.projectPath,
    item.repo,
    item.updatedAt,
    jira,
    jiraKey,
    linear,
    revision,
    maxAgeMs,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (linear) {
      const id = item.id ?? "";
      const cachedThread = peekLinearIssueThread(id);
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void linearIssueThread(id)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (jira) {
      const cachedThread = peekJiraIssueThread(jiraKey);
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void jiraIssueThread(jiraKey)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (gitlabKind) {
      const cachedThread = peekGitlabWorkItemThread(item.repo, gitlabKind, item.number);
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void gitlabWorkItemThread(item.repo, gitlabKind, item.number)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (azureDevOpsKind) {
      const cachedThread = peekAzureDevOpsWorkItemThread(item.repo, azureDevOpsKind, item.number);
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void azureDevOpsWorkItemThread(item.repo, azureDevOpsKind, item.number)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (!githubKind) return;
    const cachedThread = peekGithubWorkItemThread(
      item.repo,
      githubKind,
      item.number,
      item.projectPath,
    );
    if (cachedThread) {
      setThread(cachedThread);
      setThreadLoading(false);
      setThreadError(null);
    } else {
      setThreadLoading(true);
      setThreadError(null);
      setThread(null);
    }
    void githubWorkItemThread(item.projectPath, item.repo, githubKind, item.number, { maxAgeMs })
      .then((next) => {
        if (cancelled) return;
        setThread(next);
        setThreadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setThreadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    azureDevOpsKind,
    githubKind,
    gitlabKind,
    item.id,
    item.number,
    item.projectPath,
    item.repo,
    item.updatedAt,
    jira,
    jiraKey,
    linear,
    revision,
    maxAgeMs,
  ]);

  useEffect(() => {
    if (!isPr || !diffWanted) return;
    let cancelled = false;
    const cachedDiff = gitlab
      ? peekGitlabMrDiff(item.repo, item.number)
      : azuredevops
        ? peekAzureDevOpsMrDiff(item.repo, item.number)
        : peekGithubPrDiff(item.repo, item.number, fullFile, item.projectPath);
    if (cachedDiff) {
      setPrDiff(cachedDiff);
      setDiffLoading(false);
      setDiffError(null);
    } else {
      setDiffLoading(true);
      setDiffError(null);
      setPrDiff(null);
    }
    const pending = gitlab
      ? gitlabMrDiff(item.repo, item.number)
      : azuredevops
        ? azureDevOpsMrDiff(item.repo, item.number)
        : githubPrDiff(item.projectPath, item.repo, item.number, {
            fullContext: fullFile,
            maxAgeMs,
          });
    void pending
      .then((next) => {
        if (cancelled) return;
        setPrDiff(next);
        setDiffError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDiffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    azuredevops,
    fullFile,
    gitlab,
    isPr,
    item.number,
    item.projectPath,
    item.repo,
    item.updatedAt,
    revision,
    maxAgeMs,
    diffWanted,
  ]);

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
    details,
    loading,
    error,
    prDiff,
    diffLoading,
    diffError,
    thread,
    setThread,
    threadLoading,
    threadError,
  };
}
