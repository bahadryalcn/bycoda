import { invoke } from "@tauri-apps/api/core";
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

async function collect(reads: (() => Promise<InboxItem[]>)[]): Promise<InboxItem[]> {
  const results = await Promise.allSettled(reads.map((read) => readWithDeadline(read)));
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
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
  return collect(
    providers.map((provider) => async () => {
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
        return collect(reads);
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
        );
      }
      const ref = /^(?:(.+)([#!])|#?)(\d+)$/.exec(search);
      const explicitRepo = ref?.[1];
      const repo =
        explicitRepo ||
        (await read(() =>
          provider === "github"
            ? githubRepo(cwd)
            : provider === "gitlab"
              ? gitlabRepo(cwd)
              : azureDevOpsRepo(cwd),
        ));
      if (!repo) return [];
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
        if (ref && Number.isSafeInteger(Number(ref[3])) && Number(ref[3]) > 0) {
          reads.push(async () => {
            const rows = await read(() =>
              githubRead<GithubWorkItem[]>("github_mention_prefix", { cwd, repo, prefix: ref[3] }),
            );
            return rows.map((item): InboxItem => ({ ...item, provider, projectPath: cwd }));
          });
          for (const kind of ["issue", "pr"] as const)
            reads.push(async () => {
              const item = await read(() => githubWorkItem(cwd, repo, kind, Number(ref[3])));
              return [{ ...item, provider, projectPath: cwd }];
            });
        }
        return collect(reads);
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
      );
    }),
  );
}
