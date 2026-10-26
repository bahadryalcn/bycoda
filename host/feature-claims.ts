import { randomUUID } from "node:crypto";
import type { HostStore } from "./store";
import type {
  ManagedWorkspace,
  WorkspaceFeatureClaim,
  WorkspaceMutation,
} from "./workspace-contracts";
import type { WorkspaceFeatureClaims } from "./workspace-service-contracts";
import { projectRepositoryIdentity, workspacePolicyError } from "./workspace-policy";

function featureKey(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 512 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw workspacePolicyError(
      "WORKSPACE_FEATURE_INVALID",
      "A nonempty feature key without surrounding whitespace is required.",
    );
  return value;
}
function scopeKey(value: string | undefined): string | undefined {
  if (value === undefined) return value;
  featureKey(value);
  if (
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    value.includes("\\")
  )
    throw workspacePolicyError(
      "WORKSPACE_FEATURE_INVALID",
      "Feature scopes require nonempty slash-separated components.",
    );
  return value;
}
function overlaps(left?: string, right?: string): boolean {
  return (
    !left ||
    !right ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function createWorkspaceFeatureClaims(
  store: HostStore,
  options: { projectIdentity?: (projectId: string) => Promise<string> } = {},
): WorkspaceFeatureClaims {
  const identity =
    options.projectIdentity ?? ((projectId) => projectRepositoryIdentity(store, projectId));
  async function workspace(request: WorkspaceMutation): Promise<ManagedWorkspace> {
    if (
      typeof request.idempotencyKey !== "string" ||
      !request.idempotencyKey.trim() ||
      !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision < 0
    )
      throw workspacePolicyError(
        "WORKSPACE_MUTATION_INVALID",
        "Idempotency key and nonnegative expected revision are required.",
      );
    const value = await store.managedWorkspace(request.workspaceId);
    if (!value)
      throw workspacePolicyError("WORKSPACE_NOT_FOUND", "Managed workspace was not found.");
    if (value.revision !== request.expectedRevision)
      throw workspacePolicyError(
        "WORKSPACE_REVISION_CONFLICT",
        "Workspace changed; refresh before retrying.",
      );
    if (
      (await store.workspaceOperations(value.id)).some(
        (operation) => operation.phase !== "complete",
      )
    )
      throw workspacePolicyError(
        "WORKSPACE_RECOVERY_REQUIRED",
        "Finish workspace recovery before changing feature claims.",
      );
    return value;
  }
  return {
    async list(request) {
      if (request.featureKey !== undefined) featureKey(request.featureKey);
      return store.workspaceFeatureClaims({
        repositoryId: await identity(request.projectId),
        featureKey: request.featureKey,
      });
    },
    async acquire(request) {
      const key = featureKey(request.featureKey),
        scope = scopeKey(request.scope);
      const receiptScope = `workspace-feature-acquire:${request.workspaceId}`;
      return store.transaction(async () => {
        const previous = await store.workspaceReceipt<
          Awaited<ReturnType<WorkspaceFeatureClaims["acquire"]>>
        >(receiptScope, request.idempotencyKey, request);
        if (previous) return previous;
        const value = await workspace(request);
        if (value.state === "merged" || value.state === "abandoned")
          throw workspacePolicyError(
            "WORKSPACE_CLOSED",
            "Closed workspaces cannot acquire live feature claims.",
          );
        const existing = await store.workspaceFeatureClaims({
          repositoryId: value.repositoryId,
          featureKey: key,
        });
        const own = existing.find(
          (claim) => claim.workspaceId === value.id && claim.scope === scope,
        );
        const conflicts = existing.filter(
          (claim) => claim.workspaceId !== value.id && overlaps(scope, claim.scope),
        );
        let response: Awaited<ReturnType<WorkspaceFeatureClaims["acquire"]>>;
        if (conflicts.length) response = { acquired: false, conflicts };
        else if (own) response = { acquired: true, claim: own };
        else {
          const claim: WorkspaceFeatureClaim = {
            id: randomUUID(),
            repositoryId: value.repositoryId,
            projectId: value.projectId,
            featureKey: key,
            ...(scope ? { scope } : {}),
            workspaceId: value.id,
            owner: value.owner,
            branchRef: value.branchRef,
            acquiredAt: Date.now(),
          };
          await store.insertWorkspaceFeatureClaim(claim);
          await store.updateManagedWorkspace(
            {
              ...value,
              revision: value.revision + 1,
              lastActivityAt: Math.max(value.lastActivityAt, claim.acquiredAt),
            },
            value.revision,
          );
          response = { acquired: true, claim };
        }
        await store.saveWorkspaceReceipt(receiptScope, request.idempotencyKey, request, response);
        return response;
      });
    },
    async release(request) {
      const receiptScope = `workspace-feature-release:${request.workspaceId}`;
      return store.transaction(async () => {
        const previous = await store.workspaceReceipt<{ released: boolean }>(
          receiptScope,
          request.idempotencyKey,
          request,
        );
        if (previous) return previous;
        const value = await workspace(request);
        const released = await store.deleteWorkspaceFeatureClaim(request.claimId, value.id);
        if (released)
          await store.updateManagedWorkspace(
            { ...value, revision: value.revision + 1 },
            value.revision,
          );
        const response = { released };
        await store.saveWorkspaceReceipt(receiptScope, request.idempotencyKey, request, response);
        return response;
      });
    },
  };
}
