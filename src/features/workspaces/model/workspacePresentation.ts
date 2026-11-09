import { formatNumber, t } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import type { ManagedWorkspace, WorkspacePolicy } from "./contracts";

const GIB = 1_073_741_824;

export function workspaceStorageSize(bytes: number | null): string {
  return bytes === null
    ? t("Unknown")
    : `${formatNumber(bytes / GIB, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} GiB`;
}

/** The Host accepts only positive, safe-integer byte counts (host/workspaces/workspace-policy.ts). */
const positiveBytes = (value: number) =>
  Number.isFinite(value) && value > 0 && Number.isSafeInteger(value);

export type PolicyDiskErrors = { budget?: string; warning?: string; minimumFree?: string };

/** Mirrors the Host contract so Save is never offered for a value it will reject. */
export function workspacePolicyDiskErrors(disk: WorkspacePolicy["disk"]): PolicyDiskErrors {
  const errors: PolicyDiskErrors = {};
  if (!positiveBytes(disk.budgetBytes))
    errors.budget = t("Enter a directory budget greater than 0 GiB.");
  if (!Number.isFinite(disk.warningRatio) || disk.warningRatio <= 0 || disk.warningRatio > 1)
    errors.warning = t("Enter a warning from 1 to 100%.");
  if (!positiveBytes(disk.minimumFreeBytes))
    errors.minimumFree = t("Enter minimum free space greater than 0 GiB.");
  return errors;
}

export function lifecycleLabel(state: ManagedWorkspace["state"]) {
  return {
    active: t("Active"),
    idle: t("Idle"),
    finished: t("Finished"),
    merged: t("Merged"),
    abandoned: t("Closed"),
  }[state];
}

/**
 * When the Host may remove this workspace directory, or undefined when it never will.
 * Mirrors `workspaceRetentionEligibility` in host/workspaces/workspace-retention.ts; keep the
 * two rules in step. Pass the saved policy, not an unsaved draft.
 */
export function workspaceCleanupDueAt(
  workspace: ManagedWorkspace,
  policy: WorkspacePolicy,
): number | undefined {
  if (workspace.directoryState === "removed") return undefined;
  if (workspace.pinned || policy.pinned) return undefined;
  const state = workspace.state;
  if (state === "active") return undefined;
  const period = policy.retention[state];
  if (period === "never" || !Number.isFinite(period) || period <= 0) return undefined;
  const transition =
    state === "finished"
      ? workspace.finishedAt
      : state === "merged"
        ? workspace.mergedAt
        : state === "abandoned"
          ? workspace.closedAt
          : workspace.lastActivityAt;
  if (
    transition === undefined ||
    !Number.isFinite(transition) ||
    !Number.isFinite(workspace.lastActivityAt)
  )
    return undefined;
  // Later activity extends retention even after finish or merge, as on the Host.
  return Math.max(transition, workspace.lastActivityAt) + period;
}

export type RosterFilter = "all" | "active" | "attention";

/** Facts the roster knows beyond the workspace record itself. */
export type RosterFacts = { missing: boolean; cleanupDueAt?: number };

/**
 * Roster facts for one workspace. `missingPaths` comes from the storage read; cleanup timing
 * uses the saved policy, never an unsaved draft.
 */
export function workspaceRosterFacts(
  workspace: ManagedWorkspace,
  missingPaths: readonly string[],
  policy?: WorkspacePolicy,
): RosterFacts {
  const key = pathKey(workspace.path);
  return {
    missing: missingPaths.some((path) => pathKey(path) === key),
    cleanupDueAt: policy && workspaceCleanupDueAt(workspace, policy),
  };
}

/** Blocked cleanup, a missing folder, or a retained workspace that is due for cleanup. */
export function workspaceNeedsAttention(workspace: ManagedWorkspace, facts: RosterFacts): boolean {
  if (workspace.directoryState === "blocked" || facts.missing) return true;
  return (
    facts.cleanupDueAt !== undefined &&
    ["idle", "finished", "merged", "abandoned"].includes(workspace.state)
  );
}

export function matchesRosterFilter(
  filter: RosterFilter,
  workspace: ManagedWorkspace,
  facts: RosterFacts,
): boolean {
  if (filter === "active") return workspace.state === "active";
  if (filter === "attention") return workspaceNeedsAttention(workspace, facts);
  return true;
}
