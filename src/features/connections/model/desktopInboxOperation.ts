import {
  isRemoteJiraOperation,
  type RemoteJiraOperation,
} from "../../inbox/public/jiraBoardProtocol";
import {
  REMOTE_INBOX_PROVIDERS,
  nativeInboxCommand,
  safeInboxError,
  type DesktopInboxReply,
  type RemoteInboxOperation,
  type RemoteInboxList,
  type RemoteInboxProvider,
  type RemoteInboxQuery,
} from "../../inbox/public/remoteInbox";

export type DesktopInboxRunner = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  /**
   * `refresh` is the owner's explicit refresh: read every provider again. Otherwise a recent list
   * may answer. `onlyProviders` limits which providers are contacted at all.
   */
  list: (
    projects: { path: string }[],
    query: Omit<RemoteInboxQuery, "providers" | "refresh"> & {
      jiraEnabled?: boolean;
      onlyProviders?: RemoteInboxProvider[];
    },
    options?: { refresh?: boolean },
  ) => Promise<RemoteInboxList>;
  results: Map<string, DesktopInboxReply>;
  running: Set<string>;
  onNotesChanged?: () => void | Promise<void>;
  jira?: (operation: RemoteJiraOperation, deadline?: number) => Promise<unknown>;
};

/**
 * How old a list a paired phone may be answered from. The desktop's own Inbox and earlier phone
 * reads fill the same cache, so opening or re-filtering on the phone does not ask every provider
 * again; the owner's explicit refresh always does.
 */
export const REMOTE_INBOX_LIST_FRESH_MS = 60_000;

/** A phone's list read: a recent cached list answers at once, anything else reads the providers. */
export async function readRemoteInboxList<Query, Result>(
  cache: {
    fresh: (query: Query, maxAgeMs: number) => boolean;
    peek: (query: Query) => Result | null;
    read: (query: Query) => Promise<Result>;
  },
  query: Query,
  options?: { refresh?: boolean },
): Promise<Result> {
  if (!options?.refresh && cache.fresh(query, REMOTE_INBOX_LIST_FRESH_MS)) {
    const cached = cache.peek(query);
    if (cached) return cached;
  }
  return cache.read(query);
}

/** Executes only existing inbox contracts; auth/config/shell commands are absent. */
export async function executeDesktopInboxOperation(
  operation: RemoteInboxOperation,
  runner: Pick<DesktopInboxRunner, "invoke" | "list" | "jira">,
  deadline?: number,
): Promise<unknown> {
  if (isRemoteJiraOperation(operation)) {
    if (!runner.jira) throw new Error("Update the desktop for scoped Jira board access");
    return runner.jira(operation, deadline);
  }
  if (operation.action === "jira-comment-images") {
    return runner.invoke("jira_agent_comment_with_images", { permit: operation.permit, deadline });
  }
  if (operation.action === "review") {
    if (
      !Number.isSafeInteger(deadline) ||
      Number(deadline) <= Date.now() ||
      Number(deadline) > Date.now() + 120_000
    )
      throw new Error(
        "The desktop review approval deadline is missing or expired. Update the host and review again.",
      );
    return runner.invoke("desktop_inbox_review", { operation, deadline });
  }
  if (operation.action === "providers") {
    const commands = {
      github: "git_github_status",
      gitlab: "gitlab_status",
      azuredevops: "azure_devops_status",
      linear: "linear_status",
      jira: "jira_status",
    };
    return Promise.all(
      REMOTE_INBOX_PROVIDERS.map(async (provider) => {
        try {
          const status = (await runner.invoke(commands[provider])) as {
            connected?: boolean;
          };
          return { provider, connected: status?.connected === true };
        } catch (error) {
          return { provider, connected: false, error: safeInboxError(error) };
        }
      }),
    );
  }
  if (operation.action === "list") {
    const { providers, refresh, ...query } = operation.query;
    const wanted = (provider: string) =>
      !providers || providers.includes(provider as (typeof providers)[number]);
    // Providers that were not asked for are never contacted; the filter below stays as a guard.
    const value = await runner.list(
      operation.projects,
      {
        ...query,
        ...(providers ? { onlyProviders: [...providers] } : {}),
        ...(wanted("github") ? {} : { githubKinds: [] }),
        ...(wanted("jira") ? {} : { jiraEnabled: false }),
      },
      refresh ? { refresh: true } : undefined,
    );
    return {
      ...value,
      ...(operation.omittedProjects ? { omittedProjects: operation.omittedProjects } : {}),
      items: value.items.filter((item) => wanted(item.provider)),
      errors: Object.fromEntries(
        Object.entries(value.errors)
          .filter(([provider]) => wanted(provider))
          .map(([provider, error]) => [provider, safeInboxError(error)]),
      ),
    };
  }
  if (
    ![
      "details",
      "thread",
      "checks",
      "reviewers",
      "labels",
      "reaction",
      "comment",
      "pr-action",
      "review-context",
      "review",
    ].includes(operation.action)
  )
    throw new Error("Unsupported desktop inbox operation.");
  const { command, args } = nativeInboxCommand(operation);
  return runner.invoke(command, args);
}
