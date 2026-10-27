import { randomUUID } from "node:crypto";
import { lstat, readdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_WORKSPACE_POLICY,
  type ManagedWorkspace,
  type WorkspacePolicy,
  type WorkspaceStorageStatus,
} from "./workspace-contracts";
import type {
  RetentionScheduler,
  WorkspaceOwnerAuthorization,
  WorkspaceRemovalService,
} from "./workspace-service-contracts";
import { inventoryWorkspaceLinks, validateWorkspaceCleanupPaths } from "./workspace-cleanup";

export const WORKSPACE_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

/** Eligibility never changes lifecycle: idle time alone cannot abandon work. */
export function workspaceRetentionEligibility(
  workspace: ManagedWorkspace,
  policy: WorkspacePolicy,
  now = Date.now(),
): { eligible: boolean; dueAt?: number; reason?: string } {
  if (workspace.directoryState === "removed")
    return { eligible: false, reason: "Directory removed" };
  if (workspace.pinned || policy.pinned) return { eligible: false, reason: "Workspace pinned" };
  if (workspace.state === "active") return { eligible: false, reason: "Workspace active" };
  const period = policy.retention[workspace.state];
  if (period === "never") return { eligible: false, reason: "Retention is Never" };
  if (!Number.isFinite(period) || period <= 0)
    return { eligible: false, reason: "Invalid retention policy" };
  const transition =
    workspace.state === "finished"
      ? workspace.finishedAt
      : workspace.state === "merged"
        ? workspace.mergedAt
        : workspace.state === "abandoned"
          ? workspace.closedAt
          : workspace.lastActivityAt;
  if (
    transition === undefined ||
    !Number.isFinite(transition) ||
    !Number.isFinite(workspace.lastActivityAt)
  ) {
    return { eligible: false, reason: "Lifecycle timestamp unknown" };
  }
  // A later meaningful activity always extends retention, even after finish/merge.
  const dueAt = Math.max(transition, workspace.lastActivityAt) + period;
  return { eligible: now >= dueAt, dueAt };
}

export interface WorkspaceRetentionDependencies {
  list(): Promise<ManagedWorkspace[]>;
  get(workspaceId: string): Promise<ManagedWorkspace>;
  policy(workspace: ManagedWorkspace): Promise<WorkspacePolicy>;
  removal: Pick<WorkspaceRemovalService, "plan" | "apply">;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export function createWorkspaceRetentionScheduler(deps: WorkspaceRetentionDependencies) {
  const now = deps.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  const run: RetentionScheduler["run"] = (request) =>
    enqueue(async () => {
      const result: Awaited<ReturnType<RetentionScheduler["run"]>> = { removed: [], blocked: [] };
      const workspaces = request.workspaceId
        ? [await deps.get(request.workspaceId)]
        : await deps.list();
      for (const candidate of workspaces) {
        try {
          const workspace = await deps.get(candidate.id);
          const policy = await deps.policy(workspace);
          if (!workspaceRetentionEligibility(workspace, policy, now()).eligible) continue;
          const plan = await deps.removal.plan({
            workspaceId: workspace.id,
            expectedRevision: workspace.revision,
          });
          if (plan.dirty) throw new Error("Cleanup blocked: uncommitted changes");
          if (plan.blockers.length) throw new Error(plan.blockers.join("; "));
          const fresh = await deps.get(workspace.id);
          const freshPolicy = await deps.policy(fresh);
          if (
            fresh.revision !== workspace.revision ||
            !workspaceRetentionEligibility(fresh, freshPolicy, now()).eligible
          ) {
            throw new Error("Workspace changed during cleanup planning");
          }
          const receipt = await deps.removal.apply(
            {
              workspaceId: workspace.id,
              expectedRevision: workspace.revision,
              planToken: plan.token,
              idempotencyKey: `retention-${workspace.id}-${workspace.revision}-${plan.statusFingerprint}`,
            },
            { kind: "retentionScheduler" },
          );
          if (receipt.directoryState === "removed") result.removed.push(workspace.id);
          else
            result.blocked.push({
              workspaceId: workspace.id,
              reason: `Cleanup ${receipt.directoryState}`,
            });
        } catch (error) {
          result.blocked.push({
            workspaceId: candidate.id,
            reason: error instanceof Error ? error.message : "Cleanup failed",
          });
        }
      }
      return result;
    });
  return {
    run,
    /** Host calls once after loading the registry; no import-time timers or work. */
    async start() {
      if (timer) return;
      timer = setInterval(() => {
        void run({ trigger: "hourly" }).catch(deps.onError ?? (() => {}));
      }, WORKSPACE_RETENTION_INTERVAL_MS);
      timer.unref?.();
      return run({ trigger: "startup" });
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    onLifecycle(workspaceId: string) {
      return run({ trigger: "lifecycle", workspaceId }).catch((error: unknown) => {
        deps.onError?.(error);
        return {
          removed: [],
          blocked: [
            {
              workspaceId,
              reason: error instanceof Error ? error.message : "Lifecycle cleanup failed",
            },
          ],
        };
      });
    },
    /** Pressure expedites the same eligible set; it grants no additional deletion rights. */
    onStoragePressure() {
      return run({ trigger: "hourly" });
    },
    /** Owner-initiated quick delete skips the age threshold only, never clean/activity guards. */
    quickDelete(workspaceId: string, authority: WorkspaceOwnerAuthorization) {
      return enqueue(async () => {
        const workspace = await deps.get(workspaceId);
        if (workspace.state !== "finished" && workspace.state !== "merged") {
          throw new Error("Quick delete requires a finished or merged workspace");
        }
        const plan = await deps.removal.plan({ workspaceId, expectedRevision: workspace.revision });
        if (plan.dirty) throw new Error("Cleanup blocked: uncommitted changes");
        if (plan.blockers.length) throw new Error(plan.blockers.join("; "));
        return deps.removal.apply(
          {
            workspaceId,
            expectedRevision: workspace.revision,
            planToken: plan.token,
            idempotencyKey: `quick-delete-${randomUUID()}`,
          },
          authority,
        );
      });
    },
  };
}

export type WorkspaceStorageMeasurements = Pick<
  WorkspaceStorageStatus,
  "materializedBytes" | "sharedCacheBytes" | "recoveryBytes" | "freeBytes"
>;

export function evaluateWorkspaceStorage(
  root: string,
  measurements: WorkspaceStorageMeasurements,
  disk: WorkspacePolicy["disk"] = DEFAULT_WORKSPACE_POLICY.disk,
): WorkspaceStorageStatus {
  const valid = (value: number | null) =>
    value !== null && Number.isFinite(value) && value >= 0 ? value : null;
  const materializedBytes = valid(measurements.materializedBytes);
  const freeBytes = valid(measurements.freeBytes);
  const validPolicy =
    disk.budgetBytes > 0 &&
    Number.isFinite(disk.budgetBytes) &&
    disk.warningRatio > 0 &&
    disk.warningRatio <= 1 &&
    Number.isFinite(disk.minimumFreeBytes) &&
    disk.minimumFreeBytes >= 0;
  const shortage = validPolicy
    ? Math.max(
        0,
        materializedBytes === null ? 0 : materializedBytes - disk.budgetBytes,
        freeBytes === null ? 0 : disk.minimumFreeBytes - freeBytes,
      )
    : 0;
  const unknown = !validPolicy || materializedBytes === null || freeBytes === null;
  return {
    root,
    ...disk,
    materializedBytes,
    freeBytes,
    sharedCacheBytes: valid(measurements.sharedCacheBytes),
    recoveryBytes: valid(measurements.recoveryBytes),
    materialization: shortage > 0 ? "paused" : unknown ? "unknown" : "allowed",
    requiredFreeBytes: unknown && shortage === 0 ? null : shortage,
  };
}

/** Warning is separate from admission: 80% usage warns without blocking new work. */
export function workspaceStorageWarning(status: WorkspaceStorageStatus): boolean | null {
  if (status.materialization === "paused") return true;
  if (status.materializedBytes === null || status.freeBytes === null) return null;
  return (
    status.materializedBytes >= status.budgetBytes * status.warningRatio ||
    status.freeBytes < status.minimumFreeBytes
  );
}

export interface WorkspaceStorageMeasurementRequest {
  root: string;
  workspaces: Pick<ManagedWorkspace, "path" | "directoryState">[];
  /** Explicit roots only; this function never discovers or deletes shared data. */
  sharedCacheRoots?: string[];
  recoveryRoots?: string[];
  disk?: WorkspacePolicy["disk"];
}

/** Read-only, no-follow accounting. Shared hardlinks count once across all categories. */
export async function measureWorkspaceStorage(
  request: WorkspaceStorageMeasurementRequest,
): Promise<WorkspaceStorageStatus> {
  const seen = new Set<string>();
  const measure = async (roots: string[]): Promise<number | null> => {
    let bytes = 0;
    const measured = new Set<string>();
    try {
      for (const entry of roots) {
        const { target: root } = await validateWorkspaceCleanupPaths(entry, entry);
        const links = await inventoryWorkspaceLinks(root);
        if (links.some((link) => link.kind === "unsafe")) return null;
        const linked = new Set(links.map((link) => link.path));
        const visit = async (path: string): Promise<void> => {
          const metadata = await lstat(path, { bigint: true });
          if (metadata.isSymbolicLink() || linked.has(path)) return;
          if (metadata.isDirectory()) {
            for (const name of await readdir(path)) await visit(join(path, name));
          } else if (metadata.isFile()) {
            if (metadata.ino === 0n) throw new Error("File identity unavailable");
            const key = `${metadata.dev}:${metadata.ino}`;
            if (!seen.has(key) && !measured.has(key)) {
              measured.add(key);
              bytes += Number(metadata.size);
            }
          } else throw new Error("Unknown filesystem entry");
        };
        await visit(root);
      }
      for (const key of measured) seen.add(key);
      return bytes;
    } catch {
      return null;
    }
  };
  // Shared content belongs to its reported shared category, not mutable directory usage.
  const sharedCacheBytes = request.sharedCacheRoots
    ? await measure(request.sharedCacheRoots)
    : null;
  const recoveryBytes = request.recoveryRoots ? await measure(request.recoveryRoots) : null;
  let materializedBytes: number | null = null;
  let freeBytes: number | null = null;
  try {
    const { target: root } = await validateWorkspaceCleanupPaths(request.root, request.root);
    const paths: string[] = [];
    for (const workspace of request.workspaces) {
      if (workspace.directoryState !== "removed")
        paths.push((await validateWorkspaceCleanupPaths(request.root, workspace.path)).target);
    }
    materializedBytes = await measure(paths);
    const stats = await statfs(root, { bigint: true });
    freeBytes = Number(stats.bavail * stats.bsize);
  } catch {
    /* Unknown is preserved; a failed read is never zero. */
  }
  return evaluateWorkspaceStorage(
    request.root,
    { materializedBytes, sharedCacheBytes, recoveryBytes, freeBytes },
    request.disk,
  );
}
