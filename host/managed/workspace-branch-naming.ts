import { runGitText } from "../../src/shared/lib/processExecution.node";
import { stat } from "node:fs/promises";
import { withHostGitMutations } from "../git/git-mutations";
import type { HostStore } from "../store";
import type { ManagedWorkspace, WorkspaceOwner } from "../workspaces/workspace-contracts";
import type {
  WorkspaceRpcRequest,
  WorkspaceRpcResponse,
} from "../workspaces/workspace-rpc-contracts";

/** Git config key (per branch) that marks a branch as owned by a managed workspace. */
const MANAGED_KEY = "bycodaWorkspace";
const GIT_DEADLINE_MS = 30_000;
const TEMPORARY_BRANCH = /^refs\/heads\/by\/[0-9a-f]{8}$/;
const MAX_FRAGMENT = 40;

/**
 * Names are allocated before execution. Sessions get a temporary `by/<8hex>` branch that
 * {@link renameManagedWorkspaceBranch} may rename once; tasks get a final `by/<slug>-<8hex>`.
 */
export function managedWorkspaceNames(owner: WorkspaceOwner, slug: string, id: string) {
  if (!/^[a-zA-Z0-9-]{12,}$/.test(id)) throw new Error("Invalid workspace identity");
  const short = id.replaceAll("-", "").slice(0, 12).toLowerCase();
  if (short.length !== 12) throw new Error("Invalid workspace identity");
  const token = short.slice(0, 8);
  const name =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64)
      .replace(/-$/, "") || "work";
  return {
    branch: owner.kind === "task" ? `by/${name}-${token}` : `by/${token}`,
    directory: `wt-${short}`,
  };
}

const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd: string, args: string[]) =>
  runGitText(args, { cwd, windowsHide: true, timeout: GIT_DEADLINE_MS, env: gitEnv });
const shortName = (branch: string) => branch.replace(/^refs\/heads\//, "");

/** Marker of a sibling (extra-repository) branch: guarded from stray rename/removal, but no delivery review exists for it. */
const SIBLING_PREFIX = "sibling:";
const WORKSPACE_ID = /^[a-zA-Z0-9-]+$/;

/**
 * Records that `branch` belongs to managed workspace `workspaceId`; idempotent, so every
 * successful prepare, retry and recovery may call it. Sibling branches carry a distinct value.
 */
export async function markManagedWorkspaceBranch(
  cwd: string,
  branch: string,
  workspaceId: string,
  role: "primary" | "sibling" = "primary",
): Promise<void> {
  await git(cwd, [
    "config",
    `branch.${shortName(branch)}.${MANAGED_KEY}`,
    role === "sibling" ? `${SIBLING_PREFIX}${workspaceId}` : workspaceId,
  ]);
}

/**
 * The branch's marker value, or null when it has none. Only Git's "key absent" exit code (1)
 * means none; a timeout or any other failure throws so guards fail closed.
 */
export async function managedBranchMarker(cwd: string, branch: string): Promise<string | null> {
  try {
    const value = await git(cwd, ["config", "--get", `branch.${shortName(branch)}.${MANAGED_KEY}`]);
    return value.trim() || null;
  } catch (error) {
    const failure = error as { code?: unknown; killed?: boolean };
    if (failure.code === 1 && !failure.killed) return null;
    throw error;
  }
}

/**
 * True when the branch carries a workspace's primary marker; a hand-made `by/x` branch and a
 * sibling branch do not. Throws when ownership cannot be read: callers refuse (fail closed).
 */
export async function isManagedWorkspaceBranch(
  cwd: string,
  branch: string,
  workspaceId?: string,
): Promise<boolean> {
  const marker = await managedBranchMarker(cwd, branch);
  if (marker === null) return false;
  return workspaceId === undefined ? WORKSPACE_ID.test(marker) : marker === workspaceId;
}

/** Dependencies of {@link renameManagedWorkspaceBranch}. */
export interface RenameManagedWorkspaceContext {
  store: HostStore;
  /** True while foreign activity (anything but the owner's own turn or naming job) runs in the workspace. */
  isActive?: (workspace: ManagedWorkspace) => Promise<boolean>;
  /** Worktrees of the same workspace in other repositories, renamed together with the primary. */
  siblings?: (workspace: ManagedWorkspace) => Promise<{ repository: string; path: string }[]>;
}

const sanitizeFragment = (fragment: string) =>
  fragment
    .toLowerCase()
    .replace(/^(?:by|mc|bycoda)\/+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_FRAGMENT)
    .replace(/-+$/, "");

/** Git exit code 1 means "no such key"; a timeout or any other failure is unknown and throws. */
const configValue = (cwd: string, key: string) =>
  git(cwd, ["config", "--get", key]).catch((error: { code?: unknown; killed?: boolean }) => {
    if (error.code === 1 && !error.killed) return "";
    throw error;
  });

/** Fails closed: a branch whose upstream cannot be read is not renamed. */
const hasUpstream = async (cwd: string, name: string) => {
  for (const key of ["remote", "merge"])
    if ((await configValue(cwd, `branch.${name}.${key}`)).trim()) return true;
  return git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${name}@{upstream}`]).then(
    () => true,
    (error: { code?: unknown; killed?: boolean }) => {
      // A numeric exit code is Git saying "no upstream"; a timeout or spawn failure is unknown.
      if (typeof error.code === "number" && !error.killed) return false;
      throw error;
    },
  );
};

/** true / false when Git answers, null when it could not (timeout, missing folder). */
const branchPresence = (cwd: string, branch: string): Promise<boolean | null> =>
  git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(
    () => true,
    (error: { code?: unknown; killed?: boolean }) =>
      error.code === 1 && !error.killed ? false : null,
  );

type Tree = { cwd: string; role: "primary" | "sibling" };

const folderGone = (cwd: string) =>
  stat(cwd).then(
    () => false,
    () => true,
  );

/**
 * Renames `from` to `to` in each tree holding only `from` (branch -m carries the marker along);
 * true when every tree then holds only `to`. A tree whose folder no longer exists is skipped.
 */
async function moveBranches(trees: Tree[], from: string, to: string): Promise<boolean> {
  let consistent = true;
  for (const { cwd } of trees) {
    if (await folderGone(cwd)) continue;
    const hasFrom = await branchPresence(cwd, from);
    const hasTo = await branchPresence(cwd, to);
    if (hasFrom && hasTo === false) {
      try {
        await git(cwd, ["branch", "-m", from, to]);
      } catch {
        // The real state below decides, not this error (an outcome-unknown rename may have applied).
      }
    }
    const nowFrom = await branchPresence(cwd, from);
    const nowTo = await branchPresence(cwd, to);
    if (!(nowTo === true && nowFrom === false)) consistent = false;
  }
  return consistent;
}

/**
 * Registry side of a rename, in one transaction: reads the workspace fresh (heartbeats bump the
 * revision outside the gate), updates branch and sibling rows, clears the journal.
 */
async function commitRename(
  store: HostStore,
  workspaceId: string,
  to: string,
  from: string,
  receipt?: { scope: string; key: string; request: unknown },
): Promise<WorkspaceRpcResponse<"workspaces.renameBranch">> {
  return store.transaction(async () => {
    const current = await store.managedWorkspace(workspaceId);
    if (!current) throw new Error("Managed workspace not found");
    let result = { branchRef: current.branchRef, renamed: false, revision: current.revision };
    if (current.branchRef !== `refs/heads/${to}`) {
      const next = { ...current, branchRef: `refs/heads/${to}`, revision: current.revision + 1 };
      await store.updateManagedWorkspace(next, current.revision, { renameBranch: true });
      result = { branchRef: next.branchRef, renamed: true, revision: next.revision };
    }
    await store.renameWorkspaceSiblingBranches(workspaceId, from, to);
    await store.clearWorkspaceBranchRename(workspaceId);
    if (receipt)
      await store.saveWorkspaceReceipt(receipt.scope, receipt.key, receipt.request, result);
    return result;
  });
}

/** Holds the gates of every repository in one canonical order (see withHostGitMutations). */
const withRepositories = withHostGitMutations;

/**
 * Renames a managed workspace's temporary `by/<8hex>` branch to `by/<fragment>`.
 *
 * On a name collision the suffixes -2..-9 are tried, then the temporary name is kept
 * (`renamed: false`). The rename runs in the primary and every sibling worktree under every
 * repository's mutation gate; the intent is journaled before Git runs and the record's
 * `branchRef`, revision and sibling rows change in one store transaction that re-reads the
 * workspace. A failure settles from the real Git state and keeps the journal until every
 * repository agrees; the next rename or startup finishes the rest. Refused while foreign
 * activity runs (the owner's own turn does not count), an upstream is set (or cannot be read)
 * or a delivery is pending. `expectedRevision` is advisory. Idempotent by `idempotencyKey`.
 */
export async function renameManagedWorkspaceBranch(
  context: RenameManagedWorkspaceContext,
  request: WorkspaceRpcRequest<"workspaces.renameBranch">,
): Promise<WorkspaceRpcResponse<"workspaces.renameBranch">> {
  const { store } = context;
  if (
    typeof request.idempotencyKey !== "string" ||
    !request.idempotencyKey.trim() ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0
  )
    throw new Error("Workspace mutation requires an idempotency key and nonnegative revision");
  const scope = `workspace.renameBranch:${request.workspaceId}`;
  const prior = () =>
    store.workspaceReceipt<WorkspaceRpcResponse<"workspaces.renameBranch">>(
      scope,
      request.idempotencyKey,
      request,
      { admit: true },
    );
  const done = await prior();
  if (done) return done;
  const initial = await store.managedWorkspace(request.workspaceId);
  if (!initial) throw new Error("Managed workspace not found");
  const project = await store.project(initial.projectId);
  const siblings = (await context.siblings?.(initial)) ?? [];
  const repositories = [project.cwd, ...siblings.map((entry) => entry.repository)];
  return withRepositories(repositories, async () => {
    const replay = await prior();
    if (replay) return replay;
    // A rename an earlier call left half done is settled first, from the real Git state.
    const pending = (await store.pendingWorkspaceBranchRenames()).find(
      (entry) => entry.workspaceId === request.workspaceId,
    );
    if (pending) {
      await reconcileRename(context, pending);
      if (
        (await store.pendingWorkspaceBranchRenames()).some(
          (e) => e.workspaceId === pending.workspaceId,
        )
      )
        throw new Error("An earlier branch rename needs recovery; retry later");
    }
    const workspace = await store.managedWorkspace(request.workspaceId);
    if (!workspace) throw new Error("Managed workspace not found");
    if (!TEMPORARY_BRANCH.test(workspace.branchRef))
      return { branchRef: workspace.branchRef, renamed: false, revision: workspace.revision };
    if (
      workspace.state === "merged" ||
      workspace.directoryState !== "present" ||
      (await store.workspaceHasPendingOperations(workspace.id)) ||
      (await context.isActive?.(workspace)) ||
      (await store.workspaceActivityPersistence().load()).reservations.some(
        (reservation) => reservation.workspaceId === workspace.id,
      )
    )
      throw new Error("Workspace must be idle with no pending delivery before renaming its branch");
    const oldName = shortName(workspace.branchRef);
    const trees: Tree[] = [
      { cwd: workspace.path, role: "primary" },
      ...siblings.map((entry) => ({ cwd: entry.path, role: "sibling" as const })),
    ];
    for (const { cwd } of trees)
      if (await hasUpstream(cwd, oldName))
        throw new Error("A branch with an upstream cannot be renamed");
    const base = sanitizeFragment(request.fragment);
    let chosen: string | null = null;
    for (const candidate of base
      ? [base, ...Array.from({ length: 8 }, (_, index) => `${base}-${index + 2}`)]
      : []) {
      const name = `by/${candidate}`;
      let taken = false;
      for (const { cwd } of trees) taken ||= (await branchPresence(cwd, name)) !== false;
      if (!taken) {
        chosen = name;
        break;
      }
    }
    if (!chosen) {
      const result = {
        branchRef: workspace.branchRef,
        renamed: false,
        revision: workspace.revision,
      };
      await store.transaction(async () => {
        await store.saveWorkspaceReceipt(scope, request.idempotencyKey, request, result);
      });
      return result;
    }
    // Journal first: a crash between Git and the registry is reconciled at startup.
    await store.saveWorkspaceBranchRename(workspace.id, oldName, chosen);
    try {
      for (const { cwd, role } of trees) {
        await git(cwd, ["branch", "-m", oldName, chosen]);
        // `branch -m` carries the section along; set it explicitly so the marker never depends on it.
        await markManagedWorkspaceBranch(cwd, chosen, workspace.id, role);
      }
    } catch (error) {
      // Put every repository back from what Git really holds; keep the journal unless all agree.
      if (await moveBranches(trees, chosen, oldName))
        await store.clearWorkspaceBranchRename(workspace.id);
      throw error;
    }
    // A failure here keeps the journal: Git is renamed everywhere, reconcile completes forward.
    return commitRename(store, workspace.id, chosen, oldName, {
      scope,
      key: request.idempotencyKey,
      request,
    });
  });
}

/**
 * Settles one journaled rename from the real Git state. The primary decides: when it already
 * carries the new name the rename completes (siblings follow, rows and record are updated);
 * when it still has the old name the siblings are put back. The journal stays when Git cannot
 * be read or the repositories disagree.
 */
async function reconcileRename(
  context: RenameManagedWorkspaceContext,
  rename: { workspaceId: string; from: string; to: string },
) {
  const { store } = context;
  const workspace = await store.managedWorkspace(rename.workspaceId);
  if (!workspace) return store.clearWorkspaceBranchRename(rename.workspaceId);
  const siblings = (await context.siblings?.(workspace)) ?? [];
  const sibTrees: Tree[] = siblings.map((entry) => ({ cwd: entry.path, role: "sibling" }));
  const primaryNew = await branchPresence(workspace.path, rename.to);
  const primaryOld = await branchPresence(workspace.path, rename.from);
  if (primaryNew === true && primaryOld === false) {
    await markManagedWorkspaceBranch(workspace.path, rename.to, workspace.id);
    for (const tree of sibTrees) {
      if (await folderGone(tree.cwd)) continue;
      if (!(await moveBranches([tree], rename.from, rename.to))) return;
      await markManagedWorkspaceBranch(tree.cwd, rename.to, workspace.id, "sibling");
    }
    await commitRename(store, workspace.id, rename.to, rename.from);
  } else if (primaryOld === true && primaryNew === false) {
    if (await moveBranches(sibTrees, rename.to, rename.from))
      await store.clearWorkspaceBranchRename(workspace.id);
  } else if (primaryOld === false && primaryNew === false) {
    // Neither name exists: nothing left to settle.
    await store.clearWorkspaceBranchRename(workspace.id);
  }
}

/**
 * Startup: settles every interrupted rename. Each row is isolated: a failure (repository gone,
 * file lock, timeout) is logged and the row kept for a later attempt, never aborting boot.
 */
export async function reconcileBranchRenames(context: RenameManagedWorkspaceContext) {
  for (const rename of await context.store.pendingWorkspaceBranchRenames())
    try {
      await reconcileRename(context, rename);
    } catch (error) {
      console.warn(
        `Branch rename of workspace ${rename.workspaceId} stays pending: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
}
