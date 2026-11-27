import { invoke } from "@tauri-apps/api/core";
import { machineProjects } from "../../automations/public/hostMachines";
import {
  loadRemoteCapabilities,
  remoteMachineFor,
  remoteRequest,
} from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import {
  GITHUB_WORK_ITEMS,
  type WorkItemResult,
} from "../../../shared/model/host-contracts/work-items";
import { errorText } from "../../../shared/lib/errors";
import { isRemoteProjectPath, pathKey } from "../../../shared/lib/paths";
import { githubRepo } from "./githubRepositories";
import {
  githubWorkItem,
  listGithubWorkItems,
  type GithubWorkItem,
  type InboxItem,
  type InboxProvider,
} from "./githubTasks";
import { githubRead } from "./githubReadGate";
import {
  jiraProjectIdsForFetch,
  listJiraProjects,
  requireHiddenJiraProjectIds,
  type JiraIssue,
} from "./jira";
import type { LinearIssue } from "./linear";
import { gitlabRepo, type GitlabWorkItem } from "./gitlab";
import { azureDevOpsRepo, type AzureDevOpsWorkItem } from "./azureDevOps";
import { jiraIssueToInboxItem, linearIssueToInboxItem } from "./inboxItemMappers";

/** Bound uncancellable native reads; callers discard late replies after query cleanup. */
export async function readWithDeadline<T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        return read();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Work item read deadline exceeded")), 8_000);
        abort = () => reject(new Error("Work item read cancelled"));
        signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

/** Why a search could not answer, so an empty list always means "no match". */
export type WorkItemSearchFailure =
  /** The project lives on another machine and no Host API serves this provider yet. */
  | "remote-host-unavailable"
  /** The project has no repository for this provider (or it could not be identified). */
  | "repository-unresolved"
  /** The provider, its CLI or the network failed. */
  | "provider-failed"
  | WorkItemResult["errors"][number]["reason"];

export class WorkItemSearchError extends Error {
  constructor(
    readonly failure: WorkItemSearchFailure,
    readonly provider: InboxProvider,
    message: string,
    options?: { cause?: unknown; retryAt?: number },
  ) {
    super(message, options);
    this.name = "WorkItemSearchError";
    this.retryAt = options?.retryAt;
  }
  readonly retryAt?: number;
}

export async function readRemoteGithubMentions(
  cwd: string,
  input: { query: string } | { number: number },
) {
  const parsed = parseRemotePath(cwd);
  const machine = parsed && (await remoteMachineFor(parsed.environmentId));
  if (
    !parsed ||
    !machine ||
    !(await loadRemoteCapabilities(machine.environmentId))?.includes(GITHUB_WORK_ITEMS)
  )
    throw new WorkItemSearchError(
      "remote-host-unavailable",
      "github",
      "GitHub mentions are unavailable on the project Host.",
    );
  const projects = await machineProjects(machine);
  const project = projects.find((entry) => pathKey(entry.cwd) === pathKey(parsed.hostPath));
  if (!project)
    throw new WorkItemSearchError(
      "repository-unresolved",
      "github",
      "This project is not registered on its Host.",
    );
  const response = await remoteRequest<WorkItemResult>(
    machine.id,
    "query" in input ? "workItems.search" : "workItems.get",
    { projectId: project.id, ...input },
    false,
    false,
    machine.environmentId,
  );
  const failure = response.errors[0];
  if (!response.items.length && failure)
    throw new WorkItemSearchError(failure.reason, "github", failure.message, {
      retryAt: failure.retryAt,
    });
  return response.items.map((row) => ({
    ...row,
    provider: "github" as const,
    projectPath: cwd,
    labels: [],
    assignees: [],
  }));
}

/** Partial results win; only a search where every read failed reports the failure. */
/** `extra` reads (lookups that may miss) add results but never decide whether the search failed. */
async function collect(
  reads: (() => Promise<InboxItem[]>)[],
  provider?: InboxProvider,
  extra: (() => Promise<InboxItem[]>)[] = [],
): Promise<InboxItem[]> {
  const settled = await Promise.allSettled(
    [...reads, ...extra].map((read) => readWithDeadline(read)),
  );
  const results = settled.slice(0, reads.length);
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected.length && rejected.length === results.length) {
    const reason = rejected[0]!.reason;
    if (reason instanceof WorkItemSearchError || !provider) throw reason;
    throw new WorkItemSearchError("provider-failed", provider, errorText(reason), {
      cause: reason,
    });
  }
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

/** Search only connected providers, under their existing credentials and repository scope. */
export async function searchWorkItemMentions(
  cwd: string,
  providers: readonly InboxProvider[],
  query: string,
  signal?: AbortSignal,
): Promise<InboxItem[]> {
  const search = query.trim().slice(0, 200);
  const read = <T>(request: () => Promise<T>) => readWithDeadline(request, signal);
  const remoteProject = isRemoteProjectPath(cwd);
  try {
    return await searchProviders();
  } catch (error) {
    // A menu that closed mid-search is not a failure anyone is waiting on.
    if (signal?.aborted) return [];
    throw error;
  }

  function searchProviders() {
    return collect(
      providers.map(
        (provider) => () =>
          searchProvider(provider).catch((error: unknown) => {
            throw error instanceof WorkItemSearchError
              ? error
              : new WorkItemSearchError("provider-failed", provider, errorText(error), {
                  cause: error,
                });
          }),
      ),
    );
  }

  async function searchProvider(provider: InboxProvider): Promise<InboxItem[]> {
    if (provider === "jira") {
      const hiddenIds = requireHiddenJiraProjectIds();
      const projectIds = hiddenIds.length
        ? jiraProjectIdsForFetch(await read(listJiraProjects), hiddenIds)
        : null;
      if (projectIds?.length === 0) return [];
      const list = async (text: string, issuePicker = false, exactKey = false) =>
        (
          await read(() =>
            invoke<JiraIssue[]>("jira_list_issues", {
              assignedToMe: false,
              state: "open",
              projectIds: projectIds ?? [],
              limit: 20,
              filters: { search: text, issuePicker, exactKey },
            }),
          )
        )
          .filter((issue) => !hiddenIds.includes(issue.teamId))
          .map(jiraIssueToInboxItem);
      const picker = /^(?:[a-z][a-z\d_]*-)?\d+$/i.test(search);
      const reads = [() => list(search, picker)];
      if (/^[a-z][a-z\d_]*-\d+$/i.test(search)) {
        reads.push(() => list(search.toUpperCase(), false, true));
      }
      return collect(reads, provider);
    }
    if (provider === "linear") {
      return collect(
        [false, ...(/^(?:[a-z][a-z\d_]*-)?\d+$/i.test(search) ? [true] : [])].map(
          (exact) => async () => {
            const issues = await read(() =>
              invoke<LinearIssue[]>("linear_list_issues", {
                assignedToMe: false,
                state: "open",
                teamIds: [],
                limit: 100,
                search,
                exact,
              }),
            );
            return issues.map(linearIssueToInboxItem);
          },
        ),
        provider,
      );
    }
    const ref = /^(?:(.+)([#!])|#?)(\d+)$/.exec(search);
    if (remoteProject && provider === "github")
      return read(() => readRemoteGithubMentions(cwd, { query: search }));
    if (remoteProject)
      throw new WorkItemSearchError(
        "remote-host-unavailable",
        provider,
        "Work items of a project on another machine can’t be searched yet.",
      );
    const explicitRepo = ref?.[1];
    const repo =
      explicitRepo ||
      (await read(() =>
        provider === "github"
          ? githubRepo(cwd)
          : provider === "gitlab"
            ? gitlabRepo(cwd)
            : azureDevOpsRepo(cwd),
      ).catch((error: unknown) => {
        // Same expected non-repository answers as automatic discovery; anything else
        // (auth, missing CLI, network) is a provider failure the user can retry.
        if (/not a git repository|no git remotes found/i.test(errorText(error)))
          throw new WorkItemSearchError("repository-unresolved", provider, errorText(error), {
            cause: error,
          });
        throw error;
      }));
    if (!repo)
      throw new WorkItemSearchError(
        "repository-unresolved",
        provider,
        "This project has no repository for this provider.",
      );
    if (provider === "github") {
      const reads = (["issue", "pr"] as const).map((kind) => async () => {
        const rows = await read(() =>
          listGithubWorkItems(cwd, repo, {
            kind,
            assignedToMe: false,
            state: "open",
            search: ref ? ref[3]! : search,
          }),
        );
        return rows.map((item): InboxItem => ({ ...item, provider, projectPath: cwd }));
      });
      // Exact-number lookups may miss: only the list reads decide whether the search failed.
      const lookups: (() => Promise<InboxItem[]>)[] = [];
      if (ref && Number.isSafeInteger(Number(ref[3])) && Number(ref[3]) > 0) {
        lookups.push(async () => {
          const rows = await read(() =>
            githubRead<GithubWorkItem[]>("github_mention_prefix", { cwd, repo, prefix: ref[3] }),
          );
          return rows.map((item): InboxItem => ({ ...item, provider, projectPath: cwd }));
        });
        for (const kind of ["issue", "pr"] as const)
          lookups.push(async () => {
            // The number is an issue or a pull request, never both: the other lookup is
            // expected to miss, and the list reads above report real provider failures.
            const item = await read(() => githubWorkItem(cwd, repo, kind, Number(ref[3]))).catch(
              (error: unknown) => {
                if (signal?.aborted) throw error;
                return null;
              },
            );
            return item ? [{ ...item, provider, projectPath: cwd }] : [];
          });
      }
      return collect(reads, provider, lookups);
    }
    return collect(
      (["issue", "pr"] as const)
        .filter(
          (kind) =>
            !ref?.[2] || provider !== "gitlab" || kind === (ref[2] === "!" ? "pr" : "issue"),
        )
        .map((kind) => async () => {
          const rows = await read(() =>
            invoke<(GitlabWorkItem | AzureDevOpsWorkItem)[]>(
              provider === "gitlab" ? "gitlab_list_work_items" : "azure_devops_list_work_items",
              {
                cwd,
                repo,
                kind,
                assignedToMe: false,
                state: "open",
                limit: 100,
                search: ref ? ref[3]! : search,
              },
            ),
          );
          return rows.map((item): InboxItem => ({ ...item, provider, repo, projectPath: cwd }));
        }),
      provider,
    );
  }
}
