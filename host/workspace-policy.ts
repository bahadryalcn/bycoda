import { isAbsolute } from "node:path";
import { hostGitRepositoryKey } from "./git-mutations";
import type { HostStore } from "./store";
import {
  DEFAULT_WORKSPACE_POLICY,
  type ResolvedWorkspacePolicy,
  type WorkspacePolicy,
  type WorkspacePolicyOverride,
} from "./workspace-contracts";
import type { WorkspacePolicyResolver } from "./workspace-service-contracts";

export function workspacePolicyError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Resolve outside SQL admission: sibling worktrees and path aliases share policy/claims. */
export async function projectRepositoryIdentity(
  store: HostStore,
  projectId: string,
): Promise<string> {
  const project = await store.project(projectId);
  // Plain folders also support current-checkout policy. The canonical key keeps
  // repository aliases shared and still rejects unreadable or malformed markers.
  return hostGitRepositoryKey(project.cwd);
}

function invalid(message: string): never {
  throw workspacePolicyError("WORKSPACE_POLICY_INVALID", message);
}

function plain(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Reject malformed wire overrides before they can weaken retention or change a root. */
export function validateWorkspacePolicyOverride(value: WorkspacePolicyOverride): void {
  if (!plain(value)) invalid("Workspace policy must be an object.");
  const keys = new Set([
    "defaultMode",
    "integrationBranchRef",
    "root",
    "pinned",
    "retention",
    "disk",
  ]);
  for (const key of Object.keys(value))
    if (!keys.has(key)) invalid(`Unknown workspace policy field: ${key}`);
  if ("defaultMode" in value && value.defaultMode !== "worktree" && value.defaultMode !== "current")
    invalid("Workspace mode must be worktree or current.");
  if ("integrationBranchRef" in value) {
    const ref = value.integrationBranchRef;
    if (
      typeof ref !== "string" ||
      !ref.startsWith("refs/heads/") ||
      ref.includes("..") ||
      ref.includes("@{") ||
      [...ref].some(
        (character) =>
          character.charCodeAt(0) <= 32 ||
          character.charCodeAt(0) === 127 ||
          "~^:?*\\[".includes(character),
      ) ||
      ref
        .split("/")
        .some(
          (part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"),
        )
    )
      invalid("Integration branch must be a valid full local branch ref.");
  }
  if (
    "root" in value &&
    value.root !== null &&
    (typeof value.root !== "string" || !isAbsolute(value.root) || value.root.includes("\0"))
  )
    invalid("Workspace root must be an absolute path or null.");
  if ("pinned" in value && typeof value.pinned !== "boolean") invalid("Pinned must be a boolean.");
  if ("retention" in value) {
    if (!plain(value.retention)) invalid("Retention must be an object.");
    const states = new Set(["active", "idle", "finished", "merged", "abandoned"]);
    for (const [state, duration] of Object.entries(value.retention)) {
      if (!states.has(state)) invalid(`Unknown retention state: ${state}`);
      if (state === "active" && duration !== "never") invalid("Active work must retain Never.");
      if (
        duration !== "never" &&
        (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0)
      )
        invalid("Retention periods must be positive finite milliseconds or never.");
    }
  }
  if ("disk" in value) {
    if (!plain(value.disk)) invalid("Disk policy must be an object.");
    for (const [key, amount] of Object.entries(value.disk)) {
      if (!["budgetBytes", "warningRatio", "minimumFreeBytes"].includes(key))
        invalid(`Unknown disk field: ${key}`);
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        (key === "warningRatio" && amount > 1) ||
        (key !== "warningRatio" && !Number.isSafeInteger(amount))
      )
        invalid("Disk limits must be positive safe byte counts; warningRatio must be in (0, 1].");
    }
  }
}

function merge(base: WorkspacePolicy, override: WorkspacePolicyOverride): WorkspacePolicy {
  return {
    ...base,
    ...override,
    retention: { ...base.retention, ...override.retention, active: "never" },
    disk: { ...base.disk, ...override.disk },
  };
}

export function createWorkspacePolicyResolver(
  store: HostStore,
  options: {
    hostPolicy?: WorkspacePolicyOverride;
    projectIdentity?: (projectId: string) => Promise<string>;
  } = {},
): WorkspacePolicyResolver {
  const hostPolicy = structuredClone(options.hostPolicy ?? {});
  validateWorkspacePolicyOverride(hostPolicy);
  const defaults = merge(DEFAULT_WORKSPACE_POLICY, hostPolicy);
  const identity =
    options.projectIdentity ?? ((projectId) => projectRepositoryIdentity(store, projectId));
  const resolve = (
    project: WorkspacePolicyOverride | undefined,
    choice?: WorkspacePolicyOverride,
  ): ResolvedWorkspacePolicy => {
    if (choice) validateWorkspacePolicyOverride(choice);
    let policy = merge(defaults, project ?? {});
    if (choice) policy = merge(policy, choice);
    return {
      policy,
      appliedScopes: [
        "host",
        ...(project ? ["project" as const] : []),
        ...(choice ? ["owner" as const] : []),
      ],
    };
  };
  return {
    async resolve(request) {
      const repositoryId = await identity(request.projectId);
      const row = await store.workspacePolicy(repositoryId, request.environmentId);
      return resolve(row?.policy, request.choice);
    },
    async get(request) {
      const repositoryId = await identity(request.projectId);
      const row = await store.workspacePolicy(repositoryId, request.environmentId);
      return { revision: row?.revision ?? 0, resolved: resolve(row?.policy) };
    },
    async update(request, owner) {
      if (!owner?.ownerId || !owner.authorizationId)
        throw workspacePolicyError(
          "WORKSPACE_OWNER_REQUIRED",
          "Project workspace policy requires authenticated owner authorization.",
        );
      if (
        typeof request.environmentId !== "string" ||
        !request.environmentId.trim() ||
        typeof request.idempotencyKey !== "string" ||
        !request.idempotencyKey.trim() ||
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0
      )
        invalid("Environment, idempotency key and a nonnegative expected revision are required.");
      validateWorkspacePolicyOverride(request.policy);
      const repositoryId = await identity(request.projectId);
      const scope = `workspace-policy:${repositoryId}:${request.environmentId}`;
      return store.transaction(async () => {
        const previous = await store.workspaceReceipt<
          Awaited<ReturnType<WorkspacePolicyResolver["get"]>>
        >(scope, request.idempotencyKey, request);
        if (previous) return previous;
        const row = await store.saveWorkspacePolicy(
          repositoryId,
          request.environmentId,
          request.policy,
          request.expectedRevision,
        );
        const response = { revision: row.revision, resolved: resolve(row.policy) };
        await store.saveWorkspaceReceipt(scope, request.idempotencyKey, request, response);
        return response;
      });
    },
  };
}
