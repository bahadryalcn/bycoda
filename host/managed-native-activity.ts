import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import {
  canonicalWorkspaceEntry,
  canonicalWorkspacePath,
  workspacePathKey as pathKey,
} from "./workspace-paths";
import { withHostGitMutation } from "./git-mutations";
import { durableWrite } from "./turn-git-history";
import { createNativeBufferReports } from "./native-buffer-reports";
export type { NativeBufferSnapshot } from "./native-buffer-reports";
import type { ManagedWorkspace } from "./workspace-contracts";
import type {
  ExecutionActivityReservations,
  WorkspaceOwnerAuthorization,
} from "./workspace-service-contracts";

export interface NativeActivityStart {
  activityId: string;
  cwd: string;
  kind: "provider" | "shell" | "terminal";
  sessionId?: string;
}
interface ProcessLease extends NativeActivityStart {
  device: string;
  workspaceId: string;
  activityOwnerId: string;
  phase: "starting" | "active" | "ending" | "ended";
  sharedActivityId?: string;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contains = (root: string, target: string) =>
  pathKey(root) === pathKey(target) || pathKey(target).startsWith(`${pathKey(root)}${sep}`);
const identity = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0"))
    throw new Error(`Invalid native ${label}`);
  return value;
};

/** Native process reports are device-bound durable leases. Time alone never releases them.
 * Buffer probes are evaluated freshly by the shared reservation gate, including after restart. */
export function createManagedNativeActivity(deps: {
  exactGitRewindEnabled?(): Promise<boolean>;
  root: string;
  workspace(id: string): Promise<ManagedWorkspace>;
  listWorkspaces(): Promise<ManagedWorkspace[]>;
  activity: ExecutionActivityReservations;
  assertWritable(id: string): Promise<void>;
  authorize(owner: WorkspaceOwnerAuthorization): Promise<boolean>;
  now?(): number;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = tail.then(action);
    tail = result.catch(() => undefined);
    return result;
  };
  const authenticate = async (owner: WorkspaceOwnerAuthorization) => {
    if (!owner?.ownerId || !owner.authorizationId || !(await deps.authorize(owner)))
      throw new Error("Native activity requires authenticated owner authorization");
    return digest(owner.ownerId);
  };
  const leasePath = (activityId: string) =>
    join(deps.root, "native-activity", "processes", `${digest(activityId)}.json`);
  const read = async <T>(path: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const canonicalWorkspace = async (cwd: string) => {
    if (!isAbsolute(cwd) || cwd.includes("\0")) throw new Error("Native cwd must be absolute");
    const canonical = await canonicalWorkspacePath(cwd);
    const candidates = (
      await Promise.all(
        (await deps.listWorkspaces()).map(async (entry) => {
          try {
            return { ...entry, path: await canonicalWorkspaceEntry(entry.path) };
          } catch {
            // A broken sibling must not block admission to a healthy workspace.
            // It cannot become a candidate for this canonical cwd.
            return null;
          }
        }),
      )
    ).filter((entry): entry is ManagedWorkspace => !!entry && contains(entry.path, canonical));
    candidates.sort((a, b) => b.path.length - a.path.length);
    const candidate = candidates[0];
    if (!candidate) throw new Error("Native cwd has no registered managed workspace");
    const stored = await deps.workspace(candidate.id);
    const workspace = { ...stored, path: await canonicalWorkspaceEntry(stored.path) };
    if (workspace.directoryState !== "present" || !contains(workspace.path, canonical))
      throw new Error("Native workspace canonical identity changed");
    return { workspace, canonical };
  };
  const buffers = createNativeBufferReports({
    root: deps.root,
    listWorkspaces: () => deps.listWorkspaces(),
    serial,
    authenticate,
    now: deps.now,
  });
  const probe = buffers.probe;
  return {
    probe,
    start(request: NativeActivityStart, owner: WorkspaceOwnerAuthorization) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.activityId, "activity identity");
        if (!["provider", "shell", "terminal"].includes(request.kind))
          throw new Error("Invalid native process kind");
        if (request.sessionId !== undefined) identity(request.sessionId, "session identity");
        const { workspace, canonical } = await canonicalWorkspace(request.cwd);
        if (
          request.sessionId &&
          (workspace.owner.kind !== "session" || workspace.owner.id !== request.sessionId)
        )
          throw new Error("Native session does not own this workspace");
        // Ordinary execution needs no durable admission lease. Retain old leases
        // for explicit lifecycle/destructive-operation safety and experimental recovery.
        if ((await deps.exactGitRewindEnabled?.()) !== true)
          return { activityId: request.activityId, workspaceId: workspace.id };
        return withHostGitMutation(workspace.path, async () => {
          await deps.workspace(workspace.id);
          await deps.assertWritable(workspace.id);
          const path = leasePath(request.activityId);
          let lease = await read<ProcessLease>(path);
          if (lease) {
            if (
              lease.device !== device ||
              lease.workspaceId !== workspace.id ||
              pathKey(lease.cwd) !== pathKey(canonical) ||
              lease.kind !== request.kind ||
              lease.sessionId !== request.sessionId
            )
              throw new Error("Native activity identity belongs to another request or device");
            if (lease.phase === "ended" || lease.phase === "ending")
              throw new Error("Native activity already ended or requires release reconciliation");
          } else {
            lease = {
              ...request,
              cwd: canonical,
              device,
              workspaceId: workspace.id,
              activityOwnerId: `native-process:${digest([device, request.sessionId ?? null])}:${digest(request.activityId)}`,
              phase: "starting",
            };
            await durableWrite(path, JSON.stringify(lease));
          }
          const active = await deps.activity.list(workspace.id);
          const existing = active.filter((entry) => entry.ownerId === lease.activityOwnerId);
          if (existing.length > 1)
            throw new Error("Duplicate native activity requires reconciliation");
          if (!existing.length) {
            if (
              (await probe(workspace.id)).length ||
              active.some((entry) => {
                if (entry.kind === "readLease") return false;
                if (
                  request.sessionId === workspace.owner.id &&
                  workspace.owner.kind === "session" &&
                  (entry.ownerId.startsWith("native-turn:") ||
                    entry.ownerId.startsWith(
                      `native-process:${digest([device, request.sessionId])}:`,
                    ))
                )
                  return false;
                return entry.ownerId !== lease.activityOwnerId;
              })
            )
              throw new Error("Workspace has another writer or unsettled native buffers");
            if (lease.phase === "active")
              throw new Error("Native activity disappeared; reconcile before restarting");
            const entry = await deps.activity.start({
              workspaceId: workspace.id,
              kind: request.kind === "terminal" ? "shell" : request.kind,
              ownerId: lease.activityOwnerId,
            });
            lease.sharedActivityId = entry.id;
          } else lease.sharedActivityId = existing[0].id;
          lease.phase = "active";
          await durableWrite(path, JSON.stringify(lease));
          return { activityId: request.activityId, workspaceId: workspace.id };
        });
      });
    },
    end(request: { activityId: string }, owner: WorkspaceOwnerAuthorization) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.activityId, "activity identity");
        const path = leasePath(request.activityId);
        const lease = await read<ProcessLease>(path);
        if (!lease && (await deps.exactGitRewindEnabled?.()) !== true)
          return { acknowledged: true as const };
        if (!lease || lease.device !== device)
          throw new Error("Native activity is unavailable or belongs to another owner device");
        if (lease.phase === "ended") return { acknowledged: true as const };
        lease.phase = "ending";
        await durableWrite(path, JSON.stringify(lease));
        const owned = (await deps.activity.list(lease.workspaceId)).filter(
          (entry) => entry.ownerId === lease.activityOwnerId,
        );
        for (const entry of owned) await deps.activity.stop(entry.id);
        lease.phase = "ended";
        await durableWrite(path, JSON.stringify(lease));
        return { acknowledged: true as const };
      });
    },
    retireBuffers: buffers.retireBuffers,
    reconcileBuffers: buffers.reconcileBuffers,
    updateBuffers: buffers.updateBuffers,
    listBufferRecovery: buffers.listRecovery,
    readBufferRecovery: buffers.readRecovery,
    bufferRecoveryStatus: buffers.recoveryStatus,
    closeBufferRecoveryCatalog: buffers.closeRecoveryCatalog,
  };
}
