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
  type RemoteInboxQuery,
} from "../../inbox/public/remoteInbox";

export type DesktopInboxRunner = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  list: (projects: { path: string }[], query: RemoteInboxQuery) => Promise<RemoteInboxList>;
  results: Map<string, DesktopInboxReply>;
  running: Set<string>;
  onNotesChanged?: () => void | Promise<void>;
  jira?: (operation: RemoteJiraOperation, deadline?: number) => Promise<unknown>;
};

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
    const value = await runner.list(operation.projects, operation.query);
    return {
      ...value,
      errors: Object.fromEntries(
        Object.entries(value.errors).map(([provider, error]) => [provider, safeInboxError(error)]),
      ),
    };
  }
  if (
    !["details", "thread", "comment", "pr-action", "review-context", "review"].includes(
      operation.action,
    )
  )
    throw new Error("Unsupported desktop inbox operation.");
  const { command, args } = nativeInboxCommand(operation);
  return runner.invoke(command, args);
}
