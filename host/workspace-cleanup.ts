import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { execFileAsync, runGitText } from "../src/shared/lib/processExecution.node";
import { withHostGitMutation } from "./git-mutations";
import { invalidateHostWorktrees } from "./git-worktrees";
import type {
  ManagedWorkspace,
  WorkspaceActivity,
  WorkspaceCleanupPlan,
  WorkspaceRemovalOperation,
  WorkspaceReservation,
} from "./workspace-contracts";
import type {
  ExecutionActivityReservations,
  WorkspaceOwnerAuthorization,
  WorkspaceRegistry,
  WorkspaceRemovalService,
} from "./workspace-service-contracts";
import type {
  WorkspaceActivityPersistence,
  WorkspaceActivityReconciliation,
  WorkspaceActivityReconciliationRequest,
} from "./workspace-activity-store";
import type { WorkspaceMutation, WorkspaceOperation } from "./workspace-contracts";

export const sameWorkspacePath = (a: string, b: string) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
const exists = (path: string) => !!lstatSync(path, { throwIfNoEntry: false });
const inside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** Check every ancestor lexically, before any realpath or filesystem mutation. */
export function assertNoFollowPath(root: string, target: string): void {
  if (/(^|[\\/])\.{1,2}([\\/]|$)/.test(root) || /(^|[\\/])\.{1,2}([\\/]|$)/.test(target))
    throw new Error("Cleanup requires normalized absolute paths without dot segments.");
  if (!isAbsolute(root) || !isAbsolute(target) || !inside(resolve(root), resolve(target)))
    throw new Error("Cleanup path is outside its absolute managed root.");
  let current = parse(resolve(target)).root;
  for (const part of relative(current, resolve(target)).split(sep)) {
    current = join(current, part);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info?.isSymbolicLink())
      throw new Error("Cleanup cannot follow a reparse point or symbolic link.");
    if (info && !info.isDirectory()) throw new Error("Cleanup path ancestor is not a directory.");
  }
}

type Link = WorkspaceCleanupPlan["links"][number];
const dependency = (path: string, root: string) =>
  relative(root, path).split(sep).includes("node_modules");
/** Windows metadata reports unknown reparse tags too; traversal never enters any reparse entry. */
export async function inventoryWorkspaceLinks(target: string): Promise<Link[]> {
  if (!exists(target)) return [];
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $result=[Collections.Generic.List[object]]::new(); function Walk([string]$p) { foreach($e in Get-ChildItem -LiteralPath $p -Force) { if(($e.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result.Add(@{path=$e.FullName;type=$e.LinkType}) } elseif($e.PSIsContainer) { Walk $e.FullName } } }; Walk $env:BYCODA_CLEANUP_SCAN; ConvertTo-Json -Compress -InputObject @($result.ToArray())`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, BYCODA_CLEANUP_SCAN: target },
        encoding: "utf8",
      },
    );
    return (JSON.parse(stdout.trim()) as { path: string; type: string }[]).map((entry) => ({
      path: entry.path,
      kind:
        dependency(entry.path, target) &&
        entry.type === "Junction" &&
        !/Volume\{|GLOBALROOT|\\Device\\/i.test(readlinkSync(entry.path))
          ? "dependencyJunction"
          : dependency(entry.path, target) && entry.type === "SymbolicLink"
            ? "dependencySymlink"
            : "unsafe",
    }));
  }
  const links: Link[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      const info = lstatSync(child);
      if (info.isSymbolicLink())
        links.push({
          path: child,
          kind: dependency(child, target) ? "dependencySymlink" : "unsafe",
        });
      else if (info.isDirectory()) walk(child);
      else if (!info.isFile()) links.push({ path: child, kind: "unsafe" });
    }
  };
  walk(target);
  return links;
}

/** Reject unknown reparse ancestors on Windows (Node only identifies known symlink tags). */
export async function validateWorkspaceCleanupPaths(root: string, target: string) {
  assertNoFollowPath(root, target);
  if (process.platform !== "win32") return;
  const script = `$ErrorActionPreference='Stop'; $p=$env:BYCODA_CLEANUP_SCAN; while($p) { if(Test-Path -LiteralPath $p) { $e=Get-Item -LiteralPath $p -Force; if(($e.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe reparse ancestor' } }; $p=[IO.Path]::GetDirectoryName($p) }`;
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 30_000, env: { ...process.env, BYCODA_CLEANUP_SCAN: target } },
  );
}

const git = (cwd: string, args: string[]) =>
  runGitText(["-c", "core.longpaths=true", ...args], {
    cwd,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
async function registrations(cwd: string) {
  const records = (await git(cwd, ["worktree", "list", "--porcelain", "-z"]))
    .split("\0\0")
    .filter(Boolean);
  return records.map((record, index) => {
    const fields = record.split("\0");
    return {
      path: fields.find((f) => f.startsWith("worktree "))?.slice(9) ?? "",
      head: fields.find((f) => f.startsWith("HEAD "))?.slice(5) ?? "",
      branch: fields.find((f) => f.startsWith("branch "))?.slice(7) ?? "",
      locked: fields.some((f) => f === "locked" || f.startsWith("locked ")),
      main: index === 0,
    };
  });
}

async function sourceState(path: string) {
  // A failed status is propagated, never converted to a clean result.
  const status = await git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const head = (await git(path, ["rev-parse", "HEAD"])).trim();
  const branch = (await git(path, ["symbolic-ref", "HEAD"])).trim();
  const files = (await git(path, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
    .split("\0")
    .filter(Boolean);
  const hash = createHash("sha256").update(head).update(branch).update(status);
  const ignored = (
    await git(path, [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
    ])
  )
    .split("\0")
    .filter(Boolean)
    .filter(
      (file) =>
        !file.split(/[\\/]/).includes("node_modules") &&
        file !== "temp/" &&
        !file.startsWith("temp/"),
    );
  // Unknown ignored inputs may be private source. Only known dependency/evidence
  // directories are disposable; everything else requires owner preservation.
  const addPrivateFiles = (file: string) => {
    const full = resolve(path, file);
    if (!inside(path, full)) throw new Error("Unsafe ignored source path.");
    const info = lstatSync(full);
    if (info.isDirectory()) {
      for (const name of readdirSync(full)) {
        if (name === ".git")
          throw new Error("Nested repository requires private recovery support.");
        if (name !== "node_modules") addPrivateFiles(join(file, name));
      }
    } else files.push(file);
  };
  for (const file of ignored) addPrivateFiles(file);
  const index = (
    await git(path, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
  ).trim();
  if (exists(index)) hash.update(readFileSync(index));
  for (const file of [...new Set(files)].sort()) {
    const full = resolve(path, file);
    if (!inside(path, full)) throw new Error("Unsafe source path.");
    // Never read a tracked path through an ancestor link.
    assertNoFollowPath(path, dirname(full) === path ? join(path, "__validation__") : dirname(full));
    const info = lstatSync(full, { throwIfNoEntry: false });
    hash.update(file).update("\0");
    if (info?.isSymbolicLink()) hash.update(readlinkSync(full));
    else if (info?.isFile()) hash.update(readFileSync(full));
    else if (info) throw new Error("Unsupported source entry requires private recovery support.");
    else hash.update("missing");
  }
  return {
    status: status || (ignored.length ? "ignored-private-inputs" : ""),
    head,
    branch,
    fingerprint: hash.digest("hex"),
  };
}

export function createExecutionActivityReservations(deps: {
  get(workspaceId: string): Promise<ManagedWorkspace>;
  /** S3 adapters include providers, shells, buffers, servers, leases and unknown activity. */
  probe(workspaceId: string): Promise<WorkspaceActivity[]>;
  pending(workspaceId: string, exceptOperationId?: string): Promise<boolean>;
  persistence?: WorkspaceActivityPersistence;
  /** Optional journal check prevents releasing an unfinished durable operation. */
  operation?(operationId: string): Promise<WorkspaceOperation | null>;
  /** Authoritative proof that this prior-runtime host-owned process has ended.
   * No callback, unknown ownership or uncertain process state must return false. */
  canReconcileActivity?(activity: WorkspaceActivity): Promise<boolean>;
}): ExecutionActivityReservations & {
  verifyReservation(
    request: Pick<WorkspaceMutation, "workspaceId" | "expectedRevision"> & {
      reservationId: string;
    },
  ): Promise<void>;
  recoverOrphanReservations(): Promise<{
    released: string[];
    blocked: { reservationId: string; reason: string }[];
  }>;
  reconcilePreviousActivities(
    request?: WorkspaceActivityReconciliationRequest,
  ): Promise<WorkspaceActivityReconciliation>;
} {
  const activities = new Map<string, WorkspaceActivity>();
  const reservations = new Map<string, WorkspaceReservation>();
  const reserving = new Set<string>();
  const previousActivityIds = new Set<string>();
  const ready = deps.persistence
    ? deps.persistence.load().then((saved) => {
        for (const activity of saved.activities) {
          activities.set(activity.id, activity);
          previousActivityIds.add(activity.id);
        }
        for (const reservation of saved.reservations) reservations.set(reservation.id, reservation);
      })
    : Promise.resolve();
  const inUse = async (workspaceId: string) => {
    if (
      [...activities.values()].some((a) => a.workspaceId === workspaceId) ||
      (await deps.probe(workspaceId)).length
    )
      throw new Error("Workspace is still in use or activity is unknown.");
  };
  return {
    async start(input) {
      await ready;
      if (
        reserving.has(input.workspaceId) ||
        [...reservations.values()].some((r) => r.workspaceId === input.workspaceId)
      )
        throw new Error("Workspace is reserved.");
      // Install before awaiting durable recovery checks; reserve sees the start too.
      const activity = { ...input, id: randomUUID(), startedAt: Date.now() };
      activities.set(activity.id, activity);
      try {
        const artifactOperationId =
          input.kind === "operation" && input.ownerId.startsWith("task-artifacts:")
            ? input.ownerId.slice("task-artifacts:".length)
            : undefined;
        const artifactOperation = artifactOperationId
          ? await deps.operation?.(artifactOperationId)
          : undefined;
        const recoveryOperationId =
          artifactOperation?.kind === "delivery" &&
          artifactOperation.phase === "complete" &&
          artifactOperation.workspaceId === input.workspaceId &&
          artifactOperation.merge
            ? artifactOperation.id
            : undefined;
        if (await deps.pending(input.workspaceId, recoveryOperationId))
          throw new Error("Workspace recovery is pending.");
        const workspace = await deps.get(input.workspaceId);
        if (workspace.directoryState !== "present")
          throw new Error("Workspace directory is not available.");
        await deps.persistence?.saveActivity(activity);
        return activity;
      } catch (error) {
        activities.delete(activity.id);
        throw error;
      }
    },
    async stop(id) {
      await ready;
      await deps.persistence?.removeActivity(id);
      activities.delete(id);
      previousActivityIds.delete(id);
    },
    async list(id) {
      await ready;
      return [...activities.values()]
        .filter((a) => a.workspaceId === id)
        .concat(await deps.probe(id));
    },
    async reserve(input) {
      await ready;
      const sameOperation = reservations.get(`reservation:${input.operationId}`);
      if (sameOperation && sameOperation.workspaceId !== input.workspaceId)
        throw new Error("Reservation operation belongs to another workspace.");
      const previous = [...reservations.values()].find((r) => r.workspaceId === input.workspaceId);
      if (
        previous &&
        (previous.operationId !== input.operationId || previous.purpose !== input.purpose)
      )
        throw new Error("Workspace is reserved or reservation request changed.");
      if (reserving.has(input.workspaceId)) throw new Error("Workspace is reserved.");
      reserving.add(input.workspaceId);
      try {
        const workspace = await deps.get(input.workspaceId);
        if (await deps.pending(input.workspaceId, input.operationId))
          throw new Error("Workspace recovery is pending.");
        // Recovery can have already advanced the workspace under this durable reservation.
        if (
          (!previous || previous.expectedRevision !== input.expectedRevision) &&
          workspace.revision !== input.expectedRevision
        )
          throw new Error("Workspace revision changed.");
        await inUse(input.workspaceId);
        if (previous) return previous;
        const reservation = {
          ...input,
          id: `reservation:${input.operationId}`,
          acquiredAt: Date.now(),
        };
        await deps.persistence?.saveReservation(reservation);
        reservations.set(reservation.id, reservation);
        return reservation;
      } finally {
        reserving.delete(input.workspaceId);
      }
    },
    async release(id) {
      await ready;
      const reservation = reservations.get(id);
      if (reservation && deps.operation) {
        const operation = await deps.operation(reservation.operationId);
        if (operation && operation.phase !== "complete")
          throw new Error("Workspace operation must settle before releasing its reservation.");
      }
      await deps.persistence?.removeReservation(id);
      reservations.delete(id);
    },
    async verifyReservation(request) {
      await ready;
      const reservation = reservations.get(request.reservationId);
      if (!reservation || reservation.workspaceId !== request.workspaceId)
        throw new Error("Workspace reservation is missing or belongs to another workspace.");
      if ((await deps.get(request.workspaceId)).revision !== request.expectedRevision)
        throw new Error("Workspace revision changed.");
      if (await deps.pending(request.workspaceId, reservation.operationId))
        throw new Error("Workspace recovery is pending.");
      await inUse(request.workspaceId);
    },
    async recoverOrphanReservations() {
      await ready;
      const released: string[] = [];
      const blocked: { reservationId: string; reason: string }[] = [];
      if (!deps.operation) return { released, blocked };
      for (const reservation of reservations.values()) {
        try {
          // A journal owns reconciliation once intent is durable. Before intent
          // is saved, these services have not performed an authorized Git effect.
          if (await deps.operation(reservation.operationId)) continue;
          await inUse(reservation.workspaceId);
          if (await deps.pending(reservation.workspaceId, reservation.operationId))
            throw new Error("Workspace recovery is pending.");
          await deps.persistence?.removeReservation(reservation.id);
          reservations.delete(reservation.id);
          released.push(reservation.id);
        } catch (error) {
          blocked.push({
            reservationId: reservation.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { released, blocked };
    },
    async reconcilePreviousActivities(request = {}) {
      await ready;
      const released: string[] = [];
      const blocked: { activityId: string; reason: string }[] = [];
      for (const id of [...previousActivityIds]) {
        const activity = activities.get(id);
        if (!activity || (request.workspaceId && activity.workspaceId !== request.workspaceId))
          continue;
        let acquired = false;
        try {
          if (!["provider", "shell", "devServer"].includes(activity.kind))
            throw new Error(
              "Editor, native or unknown activity requires explicit owner reconciliation.",
            );
          if (reserving.has(activity.workspaceId))
            throw new Error("Workspace admission is in progress.");
          reserving.add(activity.workspaceId);
          acquired = true;
          if (
            [...activities.values()].some(
              (current) =>
                current.workspaceId === activity.workspaceId &&
                !previousActivityIds.has(current.id),
            )
          )
            throw new Error("Current-runtime activity is still in use.");
          if (!deps.canReconcileActivity || !(await deps.canReconcileActivity(activity)))
            throw new Error("Previous process ownership or stopped state is unknown.");
          if ((await deps.probe(activity.workspaceId)).length)
            throw new Error("Workspace is still in use or activity is unknown.");
          if (request.operationId) {
            const operation = await deps.operation?.(request.operationId);
            if (!operation || operation.workspaceId !== activity.workspaceId)
              throw new Error(
                "Activity recovery journal belongs to another workspace or is missing.",
              );
          }
          if (await deps.pending(activity.workspaceId, request.operationId))
            throw new Error("Another workspace operation recovery is pending.");
          await deps.persistence?.removeActivity(activity.id);
          activities.delete(activity.id);
          previousActivityIds.delete(activity.id);
          released.push(activity.id);
        } catch (error) {
          blocked.push({
            activityId: activity.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (acquired) reserving.delete(activity.workspaceId);
        }
      }
      return { released, blocked };
    },
  };
}

export interface GuardedRemovalInput {
  projectCwd: string;
  managedRoot: string;
  path: string;
  branchRef: string;
  head?: string;
  archiveRoot: string;
  operationId: string;
  allowDirty?: boolean;
  fingerprint?: string;
  /** The caller holds an exclusive start/removal reservation for this entire call. */
  inUse(): boolean | Promise<boolean>;
  phase?(
    phase: Exclude<
      WorkspaceRemovalOperation["phase"],
      "prepared" | "reserved" | "complete" | "blocked"
    >,
    recoveryIds: string[],
    archives: string[],
  ): Promise<void>;
  /** Only durable removal recovery may accept remnants whose status no longer reads. */
  recovering?: boolean;
}

/** Shared destructive primitive: legacy tasks and all managed removals use the same order. */
export async function guardedRemoveWorkspace(
  input: GuardedRemovalInput,
): Promise<{ archives: string[]; recoveryIds: string[] }> {
  return withHostGitMutation(input.projectCwd, async () => {
    await validateWorkspaceCleanupPaths(input.managedRoot, input.path);
    const listed = await registrations(input.projectCwd);
    const registered = listed.find((r) => sameWorkspacePath(r.path, input.path));
    if (listed.some((r) => r.main && sameWorkspacePath(r.path, input.path)))
      throw new Error("Main cannot be removed.");
    if (registered && (registered.branch !== input.branchRef || registered.locked))
      throw new Error("Workspace branch changed or checkout is locked.");
    if (registered && input.head && registered.head !== input.head)
      throw new Error("Workspace HEAD changed.");
    if (await input.inUse()) throw new Error("Workspace is still in use.");
    if (!registered && exists(input.path) && exists(join(input.path, ".git")))
      throw new Error("Unregistered directory contains Git metadata.");
    const links = await inventoryWorkspaceLinks(input.path);
    if (links.some((l) => l.kind === "unsafe"))
      throw new Error("Unsafe or unknown reparse point blocks cleanup.");
    if (registered && exists(input.path) && !input.recovering) {
      const state = await sourceState(input.path);
      if (state.branch !== input.branchRef || (input.head && state.head !== input.head))
        throw new Error("Workspace branch/HEAD changed.");
      if (input.fingerprint && state.fingerprint !== input.fingerprint)
        throw new Error("Cleanup fingerprint changed; preview again.");
      if (state.status && !input.allowDirty)
        throw new Error("Cleanup blocked: uncommitted changes (changes made after delivery).");
    }
    await validateWorkspaceCleanupPaths(dirname(input.archiveRoot), input.archiveRoot);
    if (sameWorkspacePath(input.archiveRoot, input.path) || inside(input.path, input.archiveRoot))
      throw new Error("Recovery must be outside the workspace.");
    const archives: string[] = [];
    const recoveryIds: string[] = [];
    for (const link of links) {
      // Revalidate each link's parents; only detach the entry, never its target.
      assertNoFollowPath(input.managedRoot, dirname(link.path));
      if (!lstatSync(link.path).isSymbolicLink())
        throw new Error("Dependency link changed during cleanup.");
      if (link.kind === "dependencyJunction") rmdirSync(link.path);
      else unlinkSync(link.path);
    }
    await input.phase?.("links-detached", recoveryIds, archives);
    await validateWorkspaceCleanupPaths(input.managedRoot, input.path);
    mkdirSync(input.archiveRoot, { recursive: true, mode: 0o700 });
    const archive = (source: string, label: string) => {
      const destination = join(input.archiveRoot, label);
      if (exists(destination))
        throw new Error("Recovery archive already exists; reconcile before retry.");
      renameSync(source, destination);
      archives.push(destination);
      return destination;
    };
    if (input.allowDirty && registered && exists(input.path) && !input.recovering) {
      // Preserve all private source (including ignored inputs), index metadata and HEAD before force removal.
      const destination = join(input.archiveRoot, "source");
      cpSync(input.path, destination, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
        filter: (source) => source !== join(input.path, ".git"),
      });
      const index = (
        await git(input.path, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
      ).trim();
      if (exists(index)) copyFileSync(index, join(input.archiveRoot, "index"));
      const ref = `refs/bycoda/rewinds/${input.operationId}/rescue-head`;
      await git(input.projectCwd, ["update-ref", ref, registered.head]);
      const indexRef = `refs/bycoda/rewinds/${input.operationId}/rescue-index`;
      // A copied index alone does not retain staged-only blobs against Git GC.
      // Write through the copied index so the source fingerprint remains unchanged.
      const indexTree = (
        await runGitText(["write-tree"], {
          cwd: input.path,
          windowsHide: true,
          timeout: 30_000,
          env: { ...process.env, GIT_INDEX_FILE: join(input.archiveRoot, "index") },
        })
      ).trim();
      await git(input.projectCwd, ["update-ref", indexRef, indexTree]);
      writeFileSync(
        join(input.archiveRoot, "source-state.json"),
        JSON.stringify({
          head: registered.head,
          branchRef: input.branchRef,
          fingerprint: input.fingerprint,
        }),
        { mode: 0o600 },
      );
      recoveryIds.push(ref, indexRef, destination);
      if (input.fingerprint && (await sourceState(input.path)).fingerprint !== input.fingerprint)
        throw new Error("Source changed while preserving recovery material; preview again.");
    }
    if (exists(join(input.path, "temp")))
      archive(
        join(input.path, "temp"),
        exists(join(input.archiveRoot, "temp")) ? `temp-${randomUUID()}` : "temp",
      );
    await input.phase?.("evidence-preserved", recoveryIds, archives);
    if (await input.inUse()) throw new Error("Workspace is still in use.");
    if (input.recovering && exists(input.path)) {
      if (exists(join(input.path, ".git"))) {
        const state = await sourceState(input.path);
        if (state.status || (input.fingerprint && state.fingerprint !== input.fingerprint))
          throw new Error(
            "Cleanup blocked: uncommitted changes or changed source; owner preview required.",
          );
      }
      // Preserve every remaining byte, including edits made after the prior preservation.
      await validateWorkspaceCleanupPaths(input.managedRoot, input.path);
      if ((await inventoryWorkspaceLinks(input.path)).length)
        throw new Error("Links appeared during recovery; cleanup remains blocked.");
      archive(input.path, `recovered-directory-${randomUUID()}`);
    }
    if (registered) {
      try {
        await git(input.projectCwd, [
          "worktree",
          "remove",
          ...(input.allowDirty ? ["--force"] : []),
          "--",
          input.path,
        ]);
      } catch (error) {
        // Git can unregister first or partially delete. Preserve remnants, never recurse through them.
        await validateWorkspaceCleanupPaths(input.managedRoot, input.path);
        // A registered checkout may have been refused because new source appeared,
        // or may be partially deleted. Keep it fenced for explicit journal recovery.
        if (
          (await registrations(input.projectCwd)).some((r) => sameWorkspacePath(r.path, input.path))
        )
          throw error;
        if (exists(input.path)) {
          const remaining = await inventoryWorkspaceLinks(input.path);
          if (remaining.length)
            throw new Error("Links appeared during removal; cleanup remains blocked.");
          archive(input.path, `remaining-${randomUUID()}`);
        }
        if (
          (await registrations(input.projectCwd)).some((r) => sameWorkspacePath(r.path, input.path))
        )
          await git(input.projectCwd, ["worktree", "remove", "--", input.path]).catch(() => {
            throw error;
          });
      }
    } else if (exists(input.path)) archive(input.path, `remaining-${randomUUID()}`);
    await input.phase?.("git-removed", recoveryIds, archives);
    if (
      exists(input.path) ||
      (await registrations(input.projectCwd)).some((r) => sameWorkspacePath(r.path, input.path))
    )
      throw new Error("Cleanup reconciliation pending; retry after handles unlock.");
    await input.phase?.("reconciled", recoveryIds, archives);
    invalidateHostWorktrees();
    return { archives, recoveryIds };
  });
}

export interface WorkspaceCleanupDependencies {
  registry: Pick<
    WorkspaceRegistry,
    "get" | "update" | "saveOperation" | "getOperation" | "findOperation" | "listOperations"
  >;
  reservations: ExecutionActivityReservations;
  /** Resolve recorded materialization root, project checkout and private recovery root (not a changed policy root). */
  location(
    workspace: ManagedWorkspace,
  ): Promise<{ projectCwd: string; managedRoot: string; archiveRoot: string }>;
  storageStatus: WorkspaceRemovalService["storageStatus"];
  /** Re-resolve current policy, pin, lifecycle and timestamp immediately before automatic apply. */
  retentionEligible(workspace: ManagedWorkspace): Promise<boolean>;
  authorize(owner: WorkspaceOwnerAuthorization, workspace: ManagedWorkspace): Promise<boolean>;
  now?(): number;
}

/** S4 journal extension; registry adapters must persist it verbatim. Missing metadata fails closed. */
export type WorkspaceRemovalJournal = WorkspaceRemovalOperation & {
  automatic?: boolean;
  workspaceRevision?: number;
  archiveRoot?: string;
};
type RemovalJournal = WorkspaceRemovalJournal;

export function createWorkspaceRemovalService(
  deps: WorkspaceCleanupDependencies,
): WorkspaceRemovalService {
  const plans = new Map<string, WorkspaceCleanupPlan>();
  const now = deps.now ?? Date.now;
  const get = async (id: string) => {
    const w = await deps.registry.get({ workspaceId: id });
    if (!w) throw new Error("Unknown managed workspace.");
    return w;
  };
  const requireRevision = (w: ManagedWorkspace, revision: number) => {
    if (w.revision !== revision) throw new Error("Workspace revision changed.");
  };
  const service: WorkspaceRemovalService = {
    async plan(request) {
      const workspace = await get(request.workspaceId);
      requireRevision(workspace, request.expectedRevision);
      const location = await deps.location(workspace);
      const blockers: string[] = [];
      let head = "",
        fingerprint = "",
        dirty = false,
        links: Link[] = [];
      try {
        await validateWorkspaceCleanupPaths(location.managedRoot, workspace.path);
        const listed = await registrations(location.projectCwd);
        const registered = listed.find((r) => sameWorkspacePath(r.path, workspace.path));
        if (
          !registered ||
          registered.main ||
          registered.branch !== workspace.branchRef ||
          registered.locked
        )
          throw new Error("Managed ownership/branch/registration is invalid or locked.");
        const common = (
          await git(workspace.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
        ).trim();
        if (!sameWorkspacePath(common, workspace.repositoryId))
          throw new Error("Workspace repository identity changed.");
        links = await inventoryWorkspaceLinks(workspace.path);
        if (links.some((l) => l.kind === "unsafe"))
          throw new Error("Unsafe or unknown reparse point blocks cleanup.");
        const state = await sourceState(workspace.path);
        head = state.head;
        fingerprint = state.fingerprint;
        dirty = !!state.status;
        if (state.branch !== workspace.branchRef) throw new Error("Workspace branch changed.");
        if ((await deps.reservations.list(workspace.id)).length)
          throw new Error("Workspace is still in use.");
        if (workspace.state === "active") throw new Error("Active workspace cannot be removed.");
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
      const plan: WorkspaceCleanupPlan = {
        token: randomUUID(),
        expiresAt: now() + 5 * 60_000,
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        path: workspace.path,
        branchRef: workspace.branchRef,
        head,
        statusFingerprint: fingerprint,
        dirty,
        preservationRequired: dirty,
        blockers,
        links,
      };
      for (const [token, previous] of plans) if (previous.expiresAt <= now()) plans.delete(token);
      plans.set(plan.token, structuredClone(plan));
      return plan;
    },
    async apply(request, authority) {
      const existing = await deps.registry.findOperation({
        workspaceId: request.workspaceId,
        kind: "removal",
        idempotencyKey: request.idempotencyKey,
      });
      if (existing) {
        if (
          existing.kind !== "removal" ||
          existing.plan.token !== request.planToken ||
          existing.expectedRevision !== request.expectedRevision
        )
          throw new Error("Idempotency key payload changed.");
        if (existing.receipt) return existing.receipt;
        throw new Error("Removal is pending; reconcile its operation before retrying.");
      }
      const plan = plans.get(request.planToken);
      if (
        !plan ||
        plan.expiresAt < now() ||
        plan.workspaceId !== request.workspaceId ||
        plan.expectedRevision !== request.expectedRevision
      )
        throw new Error("Cleanup plan expired or changed; preview again.");
      const w = await get(request.workspaceId);
      requireRevision(w, request.expectedRevision);
      if (plan.blockers.length) throw new Error(plan.blockers.join(" "));
      const scheduler = "kind" in authority;
      if (
        scheduler
          ? plan.dirty || !(await deps.retentionEligible(w))
          : !(await deps.authorize(authority, w))
      )
        throw new Error(
          plan.dirty
            ? "Cleanup blocked: uncommitted changes"
            : "Cleanup is not authorized or eligible.",
        );
      if (!scheduler) {
        // A renewed authenticated preview may supersede a blocked operation on
        // an intact checkout. Retain all earlier archives/refs and settle its fence.
        for (const previous of await deps.registry.listOperations(w.id)) {
          if (previous.kind !== "removal" || previous.phase !== "blocked") continue;
          if (previous.plan.path !== plan.path || previous.plan.branchRef !== plan.branchRef)
            throw new Error("Blocked removal ownership changed.");
          const fence = await deps.reservations.reserve({
            workspaceId: w.id,
            operationId: previous.id,
            purpose: "removal",
            expectedRevision: w.revision,
          });
          await deps.registry.saveOperation(
            {
              ...previous,
              phase: "complete",
              resumePhase: undefined,
              updatedAt: now(),
              receipt: {
                operationId: previous.id,
                workspaceId: w.id,
                directoryState: "blocked",
                workspaceRevision: w.revision,
                retainedBranchRef: w.branchRef,
                recoveryIds: previous.recoveryIds,
              },
            },
            "blocked",
          );
          await deps.reservations.release(fence.id);
        }
      }
      const op: RemovalJournal = {
        ...request,
        id: randomUUID(),
        kind: "removal",
        phase: "prepared",
        createdAt: now(),
        updatedAt: now(),
        plan,
        recoveryIds: [],
        automatic: scheduler,
      };
      await deps.registry.saveOperation(op, null);
      return execute(op, false, scheduler);
    },
    async status({ workspaceId }) {
      const workspace = await get(workspaceId);
      const plan =
        workspace.directoryState === "removed"
          ? null
          : await service.plan({ workspaceId, expectedRevision: workspace.revision });
      return {
        // Status exposes the blocked directory state without silently consuming a caller revision.
        workspace:
          plan?.dirty || plan?.blockers.length
            ? { ...workspace, directoryState: "blocked" }
            : workspace,
        operations: await deps.registry.listOperations(workspaceId),
      };
    },
    storageStatus: deps.storageStatus,
    async detachDependencyLinks(request) {
      const operations = await deps.registry.listOperations(request.workspaceId);
      const op = operations.find(
        (candidate): candidate is WorkspaceRemovalOperation =>
          candidate.kind === "removal" &&
          candidate.reservationId === request.reservationId &&
          candidate.plan.token === request.planToken &&
          candidate.phase === "reserved",
      );
      if (!op) throw new Error("No reserved removal operation matches this plan.");
      const w = await get(request.workspaceId);
      requireRevision(w, (op as RemovalJournal).workspaceRevision ?? op.expectedRevision);
      const reservation = await deps.reservations.reserve({
        workspaceId: w.id,
        operationId: op.id,
        purpose: "removal",
        expectedRevision: w.revision,
      });
      if (reservation.id !== request.reservationId) throw new Error("Removal reservation changed.");
      const location = await deps.location(w);
      await validateWorkspaceCleanupPaths(location.managedRoot, w.path);
      if ((await sourceState(w.path)).fingerprint !== op.plan.statusFingerprint)
        throw new Error("Cleanup fingerprint changed; preview again.");
      const links = await inventoryWorkspaceLinks(w.path);
      if (links.some((link) => link.kind === "unsafe"))
        throw new Error("Unsafe or unknown reparse point blocks cleanup.");
      const detachedPaths: string[] = [];
      for (const link of links) {
        assertNoFollowPath(location.managedRoot, dirname(link.path));
        if (!lstatSync(link.path).isSymbolicLink())
          throw new Error("Dependency link changed during cleanup.");
        if (link.kind === "dependencyJunction") rmdirSync(link.path);
        else unlinkSync(link.path);
        detachedPaths.push(link.path);
      }
      await deps.registry.saveOperation(
        { ...op, phase: "links-detached", updatedAt: now() },
        "reserved",
      );
      return { detachedPaths };
    },
    async recover(operationId) {
      const op = await deps.registry.getOperation(operationId);
      if (!op || op.kind !== "removal") throw new Error("Unknown removal operation.");
      if (op.phase !== "complete") await execute(op, true);
      return (await deps.registry.getOperation(operationId))!;
    },
  };
  async function execute(
    op: RemovalJournal,
    recovering: boolean,
    scheduler = op.automatic !== false,
  ) {
    let w = await get(op.workspaceId);
    const phase = op.phase === "blocked" ? op.resumePhase : op.phase;
    // Only a durable post-preservation journal permits recovery of partial Git deletions.
    const partial =
      recovering && ["evidence-preserved", "git-removed", "reconciled"].includes(phase ?? "");
    const save = async (next: WorkspaceRemovalOperation["phase"]) => {
      const previous = op.phase;
      const saved = {
        ...op,
        phase: next,
        updatedAt: now(),
        error: undefined,
        resumePhase: undefined,
      };
      await deps.registry.saveOperation(saved, previous);
      op = saved;
    };
    try {
      if (!op.reservationId) {
        const reservation = await deps.reservations.reserve({
          workspaceId: op.workspaceId,
          operationId: op.id,
          purpose: "removal",
          expectedRevision: w.revision,
        });
        op.reservationId = reservation.id;
      } else {
        // Reacquire the fence after process restart before any recovery I/O.
        const reservation = await deps.reservations.reserve({
          workspaceId: op.workspaceId,
          operationId: op.id,
          purpose: "removal",
          expectedRevision: w.revision,
        });
        op.reservationId = reservation.id;
      }
      // Do not roll the durable recovery phase backwards on restart.
      await save(partial ? phase! : "reserved");
      w = await get(op.workspaceId);
      if (scheduler && w.directoryState !== "removed" && !(await deps.retentionEligible(w)))
        throw new Error("Cleanup is no longer eligible.");
      if (w.state === "active" || w.path !== op.plan.path || w.branchRef !== op.plan.branchRef)
        throw new Error("Workspace changed since cleanup preview.");
      if (!partial) {
        // Recover a crash between the registry transition and its journal save.
        if (
          recovering &&
          op.workspaceRevision === undefined &&
          w.directoryState === "removing" &&
          w.revision === op.expectedRevision + 1
        )
          op.workspaceRevision = w.revision;
        requireRevision(w, op.workspaceRevision ?? op.expectedRevision);
        if (w.path !== op.plan.path || w.branchRef !== op.plan.branchRef)
          throw new Error("Workspace changed since cleanup preview.");
      }
      if (w.directoryState !== "removing" && w.directoryState !== "removed") {
        w = await deps.registry.update({
          workspaceId: w.id,
          expectedRevision: w.revision,
          idempotencyKey: `${op.id}:removing:${w.revision}`,
          reservationId: op.reservationId!,
          changes: { directoryState: "removing" },
        });
        op.workspaceRevision = w.revision;
        await save(partial ? phase! : "reserved");
      }
      const location = await deps.location(w);
      const archiveRoot = op.archiveRoot ?? join(location.archiveRoot, op.id);
      op.archiveRoot = archiveRoot;
      await save(op.phase);
      await guardedRemoveWorkspace({
        ...location,
        archiveRoot,
        path: op.plan.path,
        branchRef: op.plan.branchRef,
        head: op.plan.head,
        operationId: op.id,
        allowDirty: op.plan.preservationRequired,
        fingerprint: op.plan.statusFingerprint,
        recovering: partial,
        inUse: async () => (await deps.reservations.list(w.id)).length > 0,
        phase: async (next, ids, archives) => {
          op.recoveryIds = [...new Set([...op.recoveryIds, ...ids, ...archives])];
          if (partial && (next === "links-detached" || next === "evidence-preserved")) return;
          await save(next);
        },
      });
      w = await deps.registry.update({
        workspaceId: w.id,
        expectedRevision: op.workspaceRevision ?? w.revision,
        idempotencyKey: `${op.id}:removed`,
        reservationId: op.reservationId!,
        changes: { directoryState: "removed" },
      });
      op.receipt = {
        operationId: op.id,
        workspaceId: w.id,
        directoryState: "removed",
        workspaceRevision: w.revision,
        retainedBranchRef: op.plan.branchRef,
        recoveryIds: op.recoveryIds,
        evidenceArchivePath: archiveRoot,
      };
      await save("complete");
      await deps.reservations.release(op.reservationId!);
      return op.receipt!;
    } catch (error) {
      const previous = op.phase;
      if (op.reservationId) {
        const fresh = await get(op.workspaceId);
        if (fresh.directoryState !== "removed" && fresh.directoryState !== "blocked") {
          const blocked = await deps.registry.update({
            workspaceId: fresh.id,
            expectedRevision: fresh.revision,
            idempotencyKey: `${op.id}:blocked:${fresh.revision}`,
            reservationId: op.reservationId,
            changes: { directoryState: "blocked" },
          });
          op.workspaceRevision = blocked.revision;
        }
      }
      op = {
        ...op,
        phase: "blocked",
        resumePhase: (previous === "blocked"
          ? op.resumePhase
          : previous) as WorkspaceRemovalOperation["resumePhase"],
        updatedAt: now(),
        error: {
          code: "CLEANUP_BLOCKED",
          message: error instanceof Error ? error.message : String(error),
        },
      };
      await deps.registry.saveOperation(op, previous);
      // Fence remains held. Startup adapters also consult unfinished durable operations.
      throw error;
    }
  }
  return service;
}
