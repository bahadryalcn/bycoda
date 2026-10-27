import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import {
  canonicalWorkspaceDirectory,
  canonicalWorkspaceEntry,
  canonicalWorkspacePath,
  workspacePathKey as pathKey,
} from "./workspace-paths";
import { withHostGitMutation } from "./git-mutations";
import { nativeProcessPrefix, nativeTurnPrefix } from "./native-activity-identity";
import { durableWrite } from "./turn-git-history";
import type { ManagedWorkspace, WorkspaceActivity } from "./workspace-contracts";
import type {
  ExecutionActivityReservations,
  WorkspaceOwnerAuthorization,
} from "./workspace-service-contracts";

export interface NativeActivityStart {
  activityId: string;
  cwd: string;
  kind: "provider" | "shell" | "terminal";
  sessionId?: string;
  clientId?: string;
}
export interface NativeBufferSnapshot {
  clientId: string;
  instanceId: string;
  processId: number;
  owners: {
    ownerId: string;
    updatedAt: number;
    unknown: boolean;
    buffers: { path: string; dirty: boolean }[];
  }[];
}
interface ProcessLease extends NativeActivityStart {
  device: string;
  workspaceId: string;
  activityOwnerId: string;
  phase: "starting" | "active" | "ending" | "ended";
  sharedActivityId?: string;
  /** Native child PID, durably acknowledged before its streams are exposed. */
  processId?: number;
  /** App owns the Windows kill-on-close job containing this provider tree. */
  desktopProcessId?: number;
}
interface BufferLease extends NativeBufferSnapshot {
  device: string;
  receivedAt: number;
  retiredAt?: number;
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
  root: string;
  workspace(id: string): Promise<ManagedWorkspace>;
  listWorkspaces(): Promise<ManagedWorkspace[]>;
  activity: ExecutionActivityReservations;
  assertWritable(id: string): Promise<void>;
  authorize(owner: WorkspaceOwnerAuthorization): Promise<boolean>;
  now?(): number;
}) {
  const now = deps.now ?? Date.now;
  const refreshed = new Set<string>();
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
  const bufferDirectory = join(deps.root, "native-activity", "buffers");
  const canonicalBuffer = canonicalWorkspaceDirectory;
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
  const snapshots = async () => {
    let names: string[];
    try {
      names = await readdir(bufferDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const result: BufferLease[] = [];
    for (const name of names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const value = await read<BufferLease>(join(bufferDirectory, name));
      if (value) result.push(value);
    }
    return result;
  };
  const probe = async (workspaceId: string): Promise<WorkspaceActivity[]> => {
    // Removal verifies its reservation after the directory has been tombstoned.
    // Buffer ownership still uses the registry path; it must not require a live
    // Git worktree during that final journal transition.
    const stored = (await deps.listWorkspaces()).find((entry) => entry.id === workspaceId);
    if (!stored) throw new Error("Native workspace registry identity is unavailable");
    const workspace = { ...stored, path: await canonicalWorkspaceEntry(stored.path) };
    const result: WorkspaceActivity[] = [];
    for (const report of await snapshots()) {
      if (report.retiredAt !== undefined) continue;
      const reportId = digest([report.device, report.clientId, report.instanceId]);
      const stale =
        !refreshed.has(reportId) || now() - report.receivedAt > 45_000 || report.receivedAt > now();
      const blocked =
        report.owners.length === 0 ||
        report.owners.some((owner) => {
          const unknown = owner.unknown || stale || now() - owner.updatedAt > 45_000;
          return owner.buffers.length === 0
            ? unknown
            : owner.buffers.some(
                (buffer) => contains(workspace.path, buffer.path) && (unknown || buffer.dirty),
              );
        });
      if (blocked) {
        const ownerId = `native-buffer:${digest([report.device, report.clientId, report.instanceId])}`;
        result.push({
          id: `${ownerId}:${workspaceId}`,
          workspaceId,
          kind: "editor",
          ownerId,
          startedAt: report.receivedAt,
          dirtyBuffer: true,
        });
      }
    }
    return result;
  };
  return {
    probe,
    spawned(
      request: {
        activityId: string;
        processId: number;
        desktopProcessId: number;
        clientId?: string;
      },
      owner: WorkspaceOwnerAuthorization,
    ) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.activityId, "activity identity");
        if (!Number.isSafeInteger(request.processId) || request.processId < 1)
          throw new Error("Invalid native child process identity");
        if (
          !Number.isSafeInteger(request.desktopProcessId) ||
          request.desktopProcessId < 1 ||
          request.desktopProcessId === request.processId
        )
          throw new Error("Invalid native desktop process identity");
        const path = leasePath(request.activityId);
        const lease = await read<ProcessLease>(path);
        if (!lease || lease.device !== device || lease.clientId !== request.clientId)
          throw new Error("Native activity belongs to another device or desktop client");
        return withHostGitMutation((await deps.workspace(lease.workspaceId)).path, async () => {
          const current = await read<ProcessLease>(path);
          if (!current || current.phase !== "active" || current.kind !== "provider")
            throw new Error("Native provider is unavailable for process registration");
          if (current.device !== device || current.clientId !== request.clientId)
            throw new Error("Native activity belongs to another device or desktop client");
          if (current.processId !== undefined && current.processId !== request.processId)
            throw new Error("Native child process identity changed");
          if (
            current.desktopProcessId !== undefined &&
            current.desktopProcessId !== request.desktopProcessId
          )
            throw new Error("Native desktop process identity changed");
          current.processId = request.processId;
          current.desktopProcessId = request.desktopProcessId;
          await durableWrite(path, JSON.stringify(current));
          return { acknowledged: true as const };
        });
      });
    },
    /** Internal only: the native-turn caller holds this workspace's Git gate.
     * Do not acquire serial/the Git gate here: start holds serial while waiting
     * for that same gate. Unknown legacy leases deliberately remain fenced. */
    async reconcileProcesses(
      request: {
        workspaceId: string;
        sessionId: string;
        activityOwnerId: string;
        clientId?: string;
      },
      owner: WorkspaceOwnerAuthorization,
    ) {
      const device = await authenticate(owner);
      const workspace = await deps.workspace(request.workspaceId);
      if (workspace.owner.kind !== "session" || workspace.owner.id !== request.sessionId)
        throw new Error("Native session does not own this workspace");
      let names: string[];
      const directory = join(deps.root, "native-activity", "processes");
      try {
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      let retired = false;
      for (const name of names.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry))) {
        const path = join(directory, name);
        const lease = await read<ProcessLease>(path);
        if (
          !lease ||
          lease.kind !== "provider" ||
          lease.activityOwnerId !== request.activityOwnerId ||
          lease.workspaceId !== request.workspaceId ||
          lease.sessionId !== request.sessionId ||
          lease.device !== device ||
          lease.clientId !== request.clientId
        )
          continue;
        if (retired) throw new Error("Duplicate native provider process identity");
        if (lease.phase === "ended") {
          retired = true;
          continue;
        }
        if (
          !Number.isSafeInteger(lease.processId) ||
          !lease.processId ||
          lease.processId < 1 ||
          !Number.isSafeInteger(lease.desktopProcessId) ||
          !lease.desktopProcessId ||
          lease.desktopProcessId < 1
        )
          throw new Error("Native provider process identity is unknown; recovery remains fenced");
        // A dead leader alone does not prove descendant writers exited. On
        // Windows the native app enrolls the tree in its kill-on-close job
        // before resuming the suspended provider. Both owning app and provider
        // must be proven dead. Other platforms remain fenced absent tree proof.
        for (const pid of [lease.processId, lease.desktopProcessId]) {
          let dead = false;
          try {
            process.kill(pid, 0);
          } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === "ESRCH";
          }
          if (!dead)
            throw new Error(
              "Native provider or desktop process is not proven dead; recovery remains fenced",
            );
        }
        if (process.platform !== "win32")
          throw new Error(
            "Native provider tree retirement is unproven on this platform; recovery remains fenced",
          );
        lease.phase = "ending";
        await durableWrite(path, JSON.stringify(lease));
        const owned = (await deps.activity.list(lease.workspaceId)).filter(
          (entry) => entry.ownerId === lease.activityOwnerId,
        );
        for (const entry of owned) await deps.activity.stop(entry.id);
        lease.phase = "ended";
        await durableWrite(path, JSON.stringify(lease));
        retired = true;
      }
      return retired;
    },
    start(request: NativeActivityStart, owner: WorkspaceOwnerAuthorization) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.activityId, "activity identity");
        if (!["provider", "shell", "terminal"].includes(request.kind))
          throw new Error("Invalid native process kind");
        if (request.sessionId !== undefined) identity(request.sessionId, "session identity");
        if (request.clientId !== undefined) identity(request.clientId, "desktop client identity");
        const { workspace, canonical } = await canonicalWorkspace(request.cwd);
        if (
          request.sessionId &&
          (workspace.owner.kind !== "session" || workspace.owner.id !== request.sessionId)
        )
          throw new Error("Native session does not own this workspace");
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
              lease.sessionId !== request.sessionId ||
              lease.clientId !== request.clientId
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
              activityOwnerId: request.sessionId
                ? `${nativeProcessPrefix(owner.ownerId, request.sessionId, request.clientId)}${digest(request.activityId)}`
                : `native-process:${digest([device, null])}:${digest(request.activityId)}`,
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
                  request.kind === "provider" &&
                  entry.kind === "provider" &&
                  entry.ownerId.startsWith(
                    nativeTurnPrefix(
                      owner.ownerId,
                      workspace.id,
                      request.sessionId,
                      request.clientId,
                    ),
                  )
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
    end(request: { activityId: string; clientId?: string }, owner: WorkspaceOwnerAuthorization) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.activityId, "activity identity");
        const path = leasePath(request.activityId);
        const lease = await read<ProcessLease>(path);
        if (!lease || lease.device !== device)
          throw new Error("Native activity is unavailable or belongs to another owner device");
        if (lease.clientId && lease.clientId !== request.clientId)
          throw new Error("Native activity belongs to another desktop client");
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
    retireBuffers(
      request: { clientId: string; instanceId: string; processId: number },
      owner: WorkspaceOwnerAuthorization,
    ) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.clientId, "client identity");
        identity(request.instanceId, "instance identity");
        const path = join(
          bufferDirectory,
          `${digest([device, request.clientId, request.instanceId])}.json`,
        );
        const report = await read<BufferLease>(path);
        if (!report || report.processId !== request.processId)
          throw new Error("Native buffer instance identity is unavailable");
        if (report.retiredAt !== undefined) return { acknowledged: true as const };
        if (
          !report.owners.length ||
          report.owners.some(
            (entry) => entry.unknown || entry.buffers.some((buffer) => buffer.dirty),
          )
        )
          throw new Error("Dirty or unknown buffers require explicit owner recovery");
        await durableWrite(path, JSON.stringify({ ...report, retiredAt: now() }));
        return { acknowledged: true as const };
      });
    },
    reconcileBuffers(
      request: {
        clientId: string;
        instanceId: string;
        predecessors: { instanceId: string; processId: number }[];
      },
      owner: WorkspaceOwnerAuthorization,
    ) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.clientId, "client identity");
        identity(request.instanceId, "instance identity");
        if (!Array.isArray(request.predecessors) || request.predecessors.length > 1000)
          throw new Error("Invalid predecessor identities");
        for (const entry of request.predecessors) {
          identity(entry.instanceId, "predecessor identity");
          if (!Number.isSafeInteger(entry.processId) || entry.processId < 1)
            throw new Error("Invalid predecessor process identity");
        }
        const current = await read<BufferLease>(
          join(bufferDirectory, `${digest([device, request.clientId, request.instanceId])}.json`),
        );
        if (!current || current.retiredAt !== undefined)
          throw new Error("Fresh native instance report required");
        // Native transport is pinned to the local-sync Host. The Host checks the
        // operating system itself: caller booleans, elapsed time and EPERM are
        // never evidence of death, and PID reuse conservatively keeps the fence.
        const prior = (await snapshots()).filter(
          (report) =>
            report.device === device &&
            report.clientId === request.clientId &&
            report.instanceId !== request.instanceId &&
            report.retiredAt === undefined,
        );
        for (const report of prior) {
          if (
            request.predecessors.length &&
            !request.predecessors.some(
              (entry) =>
                entry.instanceId === report.instanceId && entry.processId === report.processId,
            )
          )
            continue;
          if (
            !report.owners.length ||
            report.owners.some(
              (entry) => entry.unknown || entry.buffers.some((buffer) => buffer.dirty),
            )
          )
            throw new Error("Dirty or unknown buffers require explicit owner recovery");
          let dead = false;
          try {
            process.kill(report.processId, 0);
          } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === "ESRCH";
          }
          if (!dead) throw new Error("Previous native process is not proven dead");
          await durableWrite(
            join(bufferDirectory, `${digest([device, report.clientId, report.instanceId])}.json`),
            JSON.stringify({ ...report, retiredAt: now() }),
          );
        }
        return { acknowledged: true as const };
      });
    },
    updateBuffers(request: NativeBufferSnapshot, owner: WorkspaceOwnerAuthorization) {
      return serial(async () => {
        const device = await authenticate(owner);
        identity(request.clientId, "client identity");
        identity(request.instanceId, "instance identity");
        if (!Number.isSafeInteger(request.processId) || request.processId < 1)
          throw new Error("Invalid native process identity");
        if (!Array.isArray(request.owners) || request.owners.length > 1000)
          throw new Error("Invalid native buffer owners");
        const ownerIds = new Set<string>();
        for (const report of request.owners) {
          identity(report.ownerId, "window identity");
          if (ownerIds.has(report.ownerId)) throw new Error("Duplicate native buffer window");
          ownerIds.add(report.ownerId);
          if (
            typeof report.unknown !== "boolean" ||
            !Number.isSafeInteger(report.updatedAt) ||
            report.updatedAt < 0 ||
            report.updatedAt > now() + 5000 ||
            !Array.isArray(report.buffers) ||
            report.buffers.length > 10_000
          )
            throw new Error("Invalid native buffer snapshot");
          for (const buffer of report.buffers) {
            if (
              typeof buffer.path !== "string" ||
              !isAbsolute(buffer.path) ||
              buffer.path.includes("\0") ||
              typeof buffer.dirty !== "boolean"
            )
              throw new Error("Invalid native buffer path");
            buffer.path = await canonicalBuffer(buffer.path);
          }
        }
        const reportId = digest([device, request.clientId, request.instanceId]);
        const path = join(bufferDirectory, `${reportId}.json`);
        const previous = await read<BufferLease>(path);
        if (previous?.retiredAt !== undefined)
          throw new Error("Native buffer instance already retired");
        if (previous && previous.processId !== request.processId)
          throw new Error("Native instance process identity changed");
        const omitted = previous?.owners.filter((entry) => !ownerIds.has(entry.ownerId)) ?? [];
        const report: BufferLease = {
          clientId: request.clientId,
          instanceId: request.instanceId,
          processId: request.processId,
          owners: request.owners.concat(omitted.map((entry) => ({ ...entry, unknown: true }))),
          device,
          receivedAt: now(),
        };
        await durableWrite(path, JSON.stringify(report));
        refreshed.add(reportId);
        return { acknowledged: true as const };
      });
    },
  };
}
