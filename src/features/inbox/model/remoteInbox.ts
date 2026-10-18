/** Native provider credentials stay in the desktop. Only these inbox operations
 * cross the host heartbeat bridge; no arbitrary Tauri command can be submitted. */
export const REMOTE_INBOX_VERSION = 1;
export const REMOTE_INBOX_PROVIDERS = [
  "github",
  "gitlab",
  "azuredevops",
  "linear",
  "jira",
] as const;
export type RemoteInboxProvider = (typeof REMOTE_INBOX_PROVIDERS)[number];
export type RemoteInboxKind = "issue" | "pr" | "linear" | "jira";
export type RemoteInboxPrAction =
  | "merge"
  | "squash"
  | "rebase"
  | "draft"
  | "ready"
  | "close"
  | "reopen";
export type RemoteInboxItem = {
  provider: RemoteInboxProvider;
  kind: RemoteInboxKind;
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string;
  repo: string;
  projectPath: string;
  id?: string;
  identifier?: string;
  draft: boolean;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatarUrl?: string }[];
};
export type RemoteInboxTarget = Pick<
  RemoteInboxItem,
  "provider" | "kind" | "number" | "repo" | "projectPath"
> & {
  id?: string;
  identifier?: string;
};
export type RemoteInboxComment = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  kind: string;
  url: string;
  resolved: boolean;
  replies: RemoteInboxComment[];
  threadId?: string;
};
/** GitHub native replies address a review thread; Linear addresses a comment. */
export function inboxReplyTarget(
  provider: RemoteInboxProvider,
  comment: Pick<RemoteInboxComment, "id" | "threadId">,
): string | undefined {
  const value =
    provider === "github" ? comment.threadId : provider === "linear" ? comment.id : undefined;
  return value?.trim() || undefined;
}
export type RemoteInboxDetails = {
  body: string;
  author: string;
  baseRefName?: string;
  headRefName?: string;
  reviewDecision?: string;
};
export type RemoteInboxThread = {
  comments: RemoteInboxComment[];
  truncated: boolean;
  reviewDecision?: string;
};
export type RemoteInboxList = {
  items: RemoteInboxItem[];
  errors: Partial<Record<RemoteInboxProvider, string>>;
};
export type RemoteInboxProviderState = {
  provider: RemoteInboxProvider;
  connected: boolean;
  error?: string;
};
export type RemoteInboxQuery = {
  assignedToMe: boolean;
  state: "open" | "all";
  search: string;
  githubKinds?: ("issue" | "pr")[];
};
export type RemoteInboxReviewComment = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  startLine?: number;
};
export type RemoteInboxReview = {
  commitId: string;
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  body: string;
  comments: RemoteInboxReviewComment[];
};
export type RemoteInboxOperation =
  | { action: "providers" }
  | { action: "list"; projects: { path: string }[]; query: RemoteInboxQuery }
  | { action: "details" | "thread"; item: RemoteInboxTarget; cwd: string }
  | { action: "comment"; item: RemoteInboxTarget; cwd: string; body: string; inReplyTo?: string }
  | { action: "review-context"; item: RemoteInboxTarget; cwd: string }
  | ({ action: "review"; item: RemoteInboxTarget; cwd: string } & RemoteInboxReview)
  | {
      action: "pr-action";
      item: RemoteInboxTarget;
      cwd: string;
      prAction: RemoteInboxPrAction;
      expectedHeadOid?: string;
    };
export type DesktopInboxJob = { id: string; operation: RemoteInboxOperation };
export type DesktopInboxReply = { id: string; result?: unknown; error?: string };
export type DesktopInboxPayload = { version: number; replies?: DesktopInboxReply[] };
export type RemoteInboxJobState = "queued" | "running" | "completed" | "failed" | "uncertain";
export type RemoteInboxReceipt = {
  id: string;
  state: RemoteInboxJobState;
  result?: unknown;
  error?: string;
};
export type RemoteInboxAvailability = { available: boolean; reason?: string };

export function safeInboxError(error: unknown): string {
  return String(error)
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer …")
    .replace(/\b(token|password|passphrase|secret|credential)\s*[=:]\s*\S+/gi, "$1 …")
    .replace(/([?&](?:access_token|token|key|secret|password)=)[^&#\s]*/gi, "$1…")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1…@")
    .slice(0, 600);
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid inbox request.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string, maximum = 500, empty = false): string => {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new Error(`Invalid inbox ${label}.`);
  return value;
};
export function inboxOperationWrites(operation: RemoteInboxOperation): boolean {
  return (
    operation.action === "comment" ||
    operation.action === "pr-action" ||
    operation.action === "review"
  );
}
export function parseRemoteInboxOperation(
  input: Record<string, unknown>,
  projects: readonly { id: string; cwd: string }[],
): RemoteInboxOperation {
  const action = input.action;
  const scoped =
    input.projectId === undefined
      ? projects
      : projects.filter((project) => project.id === input.projectId);
  if (input.projectId !== undefined && scoped.length === 0)
    throw new Error("Inbox project does not belong to this computer.");
  if (action === "providers") return { action };
  if (action === "list") {
    const query = input.query === undefined ? {} : record(input.query);
    if (query.state !== undefined && query.state !== "open" && query.state !== "all")
      throw new Error("Invalid inbox state filter.");
    if (query.assignedToMe !== undefined && typeof query.assignedToMe !== "boolean")
      throw new Error("Invalid inbox assignee filter.");
    const kinds = query.githubKinds;
    if (
      kinds !== undefined &&
      (!Array.isArray(kinds) ||
        kinds.length > 2 ||
        kinds.some((kind) => kind !== "issue" && kind !== "pr"))
    )
      throw new Error("Invalid inbox item filters.");
    return {
      action,
      projects: scoped.slice(0, 40).map((project) => ({ path: project.cwd })),
      query: {
        assignedToMe: query.assignedToMe === true,
        state: query.state === "all" ? "all" : "open",
        search: query.search === undefined ? "" : text(query.search, "search", 500, true),
        ...(kinds === undefined ? {} : { githubKinds: kinds as ("issue" | "pr")[] }),
      },
    };
  }
  if (
    !["details", "thread", "comment", "pr-action", "review", "review-context"].includes(
      String(action),
    )
  )
    throw new Error("Unsupported inbox operation.");
  const target = record(input.item);
  if (!REMOTE_INBOX_PROVIDERS.includes(target.provider as RemoteInboxProvider))
    throw new Error("Unsupported inbox provider.");
  const provider = target.provider as RemoteInboxProvider;
  const kind = target.kind;
  if (
    provider === "linear"
      ? kind !== "linear"
      : provider === "jira"
        ? kind !== "jira"
        : kind !== "issue" && kind !== "pr"
  )
    throw new Error("Inbox item kind does not match its provider.");
  if (!Number.isSafeInteger(target.number) || Number(target.number) < 1)
    throw new Error("Invalid inbox item number.");
  const item: RemoteInboxTarget = {
    provider,
    kind: kind as RemoteInboxKind,
    number: Number(target.number),
    repo: text(target.repo ?? "", "repository", 1000, provider === "linear" || provider === "jira"),
    projectPath:
      typeof target.projectPath === "string"
        ? text(target.projectPath, "project path", 16_384, true)
        : "",
    ...(target.id === undefined ? {} : { id: text(target.id, "item ID", 200) }),
    ...(target.identifier === undefined
      ? {}
      : { identifier: text(target.identifier, "item key", 200) }),
  };
  if (provider === "linear" && !item.id) throw new Error("Linear issue ID is required.");
  if (provider === "jira" && !item.identifier) throw new Error("Jira issue key is required.");
  const normalized = (path: string) => {
    const value = path.replace(/\\/g, "/").replace(/\/$/, "");
    return /^[a-z]:\//i.test(value) || value.startsWith("//") ? value.toLowerCase() : value;
  };
  const matched = scoped.find(
    (candidate) => normalized(candidate.cwd) === normalized(item.projectPath),
  );
  if (item.projectPath && !matched)
    throw new Error("This inbox item belongs to another project. Select its owning project first.");
  const project = matched ?? scoped[0];
  if (provider === "github" && !project)
    throw new Error("Add this repository as a project on the computer first.");
  const cwd = project?.cwd ?? "";
  if (action === "review" || action === "review-context") {
    if (provider !== "github" || kind !== "pr")
      throw new Error("Only GitHub pull requests support reviews.");
    if (action === "review-context") return { action, item, cwd };
    const commitId = text(input.commitId, "review commit", 40);
    if (!/^[a-f0-9]{40}$/.test(commitId)) throw new Error("Invalid inbox review commit SHA.");
    if (!["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(String(input.event)))
      throw new Error("Invalid inbox review event.");
    const body = text(input.body, "review body", 30_000, input.event === "APPROVE");
    if (!Array.isArray(input.comments) || input.comments.length > 50)
      throw new Error("Invalid inbox review comments (maximum 50).");
    const comments = input.comments.map((entry): RemoteInboxReviewComment => {
      const comment = record(entry);
      const path = text(comment.path, "review path", 1000);
      if (
        path.startsWith("/") ||
        path.includes("\\") ||
        path.includes(":") ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error("Invalid inbox review relative path.");
      if (
        !Number.isSafeInteger(comment.line) ||
        Number(comment.line) < 1 ||
        Number(comment.line) > 2147483647 ||
        (comment.side !== "LEFT" && comment.side !== "RIGHT")
      )
        throw new Error("Invalid inbox review line or side.");
      if (
        comment.startLine !== undefined &&
        (!Number.isSafeInteger(comment.startLine) ||
          Number(comment.startLine) < 1 ||
          Number(comment.startLine) >= Number(comment.line))
      )
        throw new Error("Invalid inbox review line range.");
      return {
        path,
        line: Number(comment.line),
        side: comment.side,
        body: text(comment.body, "review comment", 30_000),
        ...(comment.startLine === undefined ? {} : { startLine: Number(comment.startLine) }),
      };
    });
    if (body.length + comments.reduce((total, comment) => total + comment.body.length, 0) > 60_000)
      throw new Error("Inbox review content is too large.");
    return {
      action,
      item,
      cwd,
      commitId,
      event: input.event as RemoteInboxReview["event"],
      body,
      comments,
    };
  }
  if (action === "details" || action === "thread") return { action, item, cwd };
  if (action === "comment") {
    const inReplyTo =
      input.inReplyTo === undefined ? undefined : text(input.inReplyTo, "reply ID", 200);
    if (inReplyTo && provider !== "github" && provider !== "linear")
      throw new Error("This provider supports conversation comments, without threaded replies.");
    if (inReplyTo && provider === "github" && kind !== "pr")
      throw new Error("GitHub threaded replies require a pull request review thread.");
    return {
      action,
      item,
      cwd,
      body: text(input.body, "comment", 30_000).trim(),
      ...(inReplyTo ? { inReplyTo } : {}),
    };
  }
  if (provider !== "github" || kind !== "pr")
    throw new Error("Only GitHub pull requests support native state actions on this desktop.");
  if (
    !["merge", "squash", "rebase", "draft", "ready", "close", "reopen"].includes(
      String(input.prAction),
    )
  )
    throw new Error("Unsupported pull request action.");
  const merging = ["merge", "squash", "rebase"].includes(String(input.prAction));
  const expectedHeadOid = input.expectedHeadOid;
  if (merging && (typeof expectedHeadOid !== "string" || !/^[a-f0-9]{40}$/i.test(expectedHeadOid)))
    throw new Error("Refresh and review the PR head before merging; expectedHeadOid is required.");
  return {
    action: "pr-action",
    item,
    cwd,
    prAction: input.prAction as RemoteInboxPrAction,
    ...(merging ? { expectedHeadOid: expectedHeadOid as string } : {}),
  };
}

/** The host never chooses a native command. This finite mapping is desktop-owned. */
export function nativeInboxCommand(
  operation: Exclude<RemoteInboxOperation, { action: "providers" | "list" }>,
): { command: string; args: Record<string, unknown> } {
  const { item } = operation;
  if (operation.action === "review" || operation.action === "review-context") {
    if (item.provider !== "github" || item.kind !== "pr")
      throw new Error("Unsupported inbox review.");
    return {
      command:
        operation.action === "review" ? "git_github_pr_review" : "git_github_pr_review_context",
      args: {
        cwd: operation.cwd,
        repo: item.repo,
        number: item.number,
        ...(operation.action === "review"
          ? {
              review: {
                commitId: operation.commitId,
                event: operation.event,
                body: operation.body,
                comments: operation.comments,
              },
            }
          : {}),
      },
    };
  }
  if (operation.action === "pr-action") {
    if (item.provider !== "github" || item.kind !== "pr")
      throw new Error("Unsupported inbox state action.");
    return {
      command: "git_github_pr_action",
      args: {
        cwd: operation.cwd,
        repo: item.repo,
        number: item.number,
        action: operation.prAction,
        expectedHeadOid: operation.expectedHeadOid ?? "",
      },
    };
  }
  const suffix =
    operation.action === "details"
      ? "details"
      : operation.action === "thread"
        ? "thread"
        : "comment";
  const body = operation.action === "comment" ? { body: operation.body } : {};
  if (item.provider === "github")
    return {
      command: `git_github_work_item_${suffix}`,
      args: {
        cwd: operation.cwd,
        repo: item.repo,
        kind: item.kind,
        number: item.number,
        ...body,
        ...(operation.action === "comment" ? { inReplyTo: operation.inReplyTo ?? "" } : {}),
      },
    };
  if (item.provider === "gitlab" || item.provider === "azuredevops")
    return {
      command: `${item.provider === "gitlab" ? "gitlab" : "azure_devops"}_work_item_${suffix}`,
      args: { repo: item.repo, kind: item.kind, number: item.number, ...body },
    };
  if (item.provider === "linear")
    return {
      command: `linear_issue_${suffix}`,
      args: {
        id: item.id,
        ...body,
        ...(operation.action === "comment" ? { parentId: operation.inReplyTo ?? "" } : {}),
      },
    };
  if (item.provider === "jira")
    return { command: `jira_issue_${suffix}`, args: { key: item.identifier, ...body } };
  throw new Error("Unsupported inbox provider.");
}
