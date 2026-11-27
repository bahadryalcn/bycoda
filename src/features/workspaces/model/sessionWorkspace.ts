import type { Session, WorkspaceMode } from "../../sessions";
import { isProjectlessCwd } from "../../sessions/public/projectless";
import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import { loadProjectRepositoryChoice } from "../../projects/public/additionalDirs";
import { parseRemotePath, remotePath } from "../../connections/public/remoteProjects";
import { listWorktrees } from "../../source-control/public/worktrees";
import type { ManagedWorkspace, WorkspacePolicy, WorkspaceBaseSource } from "./contracts";
import {
  WORKSPACE_CREATION_V2,
  WorkspaceCapabilityError,
  getWorkspaceCapabilities,
  requireWorkspaceCapability,
  resolveWorkspaceContext,
  workspaceRequest,
} from "./workspaceClient";

/** Kept here until the session persistence stream adds the optional wire field. */
export type ManagedWorkspaceSession = Session & { workspaceId?: string };

/** Existing conversations keep their checkout; an unset choice on new work means policy. */
export function isNewWorkspaceSession(session: Session): boolean {
  return (
    !session.worktreeCwd &&
    !(session as ManagedWorkspaceSession).workspaceId &&
    !session.blocks.some((block) => block.role === "user") &&
    !session.rewindHistory?.length
  );
}

export function needsSessionWorkspace(session: Session): boolean {
  if (isProjectlessCwd(session.cwd)) return false;
  return (
    session.cwd !== "~" &&
    !session.worktreeCwd &&
    session.workspaceMode !== "current" &&
    (session.workspaceMode === "worktree" ||
      session.blocks.some((block) => block.role === "user" && block.workspacePreparationPending) ||
      isNewWorkspaceSession(session))
  );
}

export function workspaceModeForPolicy(
  choice: WorkspaceMode | undefined,
  policy: WorkspacePolicy,
): WorkspaceMode {
  return choice ?? policy.defaultMode;
}

/** Bound for the capability/policy reads that gate a new session's first Send; above the 20 s transport timeout. */
const POLICY_READ_TIMEOUT_MS = 25_000;

/** Preparing fetches and materializes worktrees and queues behind Git mutations; matches the Host deadline. */
const PREPARE_TIMEOUT_MS = 450_000;

/**
 * Why no managed workspace was returned. `current` is the project's own policy (or the owner's
 * choice) resolving to the current checkout and may be persisted; `fallback` means the Host
 * could not provide managed workspaces, so the current checkout is only a one-off and
 * "current" must not be saved on the session.
 */
export type SessionWorkspaceOutcome = "workspace" | "not-needed" | "current" | "fallback";

export async function prepareSessionWorkspace(
  session: Session,
  managedCreationReady = true,
  options: PrepareSessionWorkspaceOptions = {},
): Promise<ManagedWorkspace | null> {
  return (await prepareSessionWorkspaceDetailed(session, managedCreationReady, options)).workspace;
}

export type PrepareSessionWorkspaceOptions = {
  /** Client-chosen id (`newCreationProgressId()`) the progress card polls; sent only to v2 Hosts. */
  progressId?: string;
};

/**
 * The request inputs a first send freezes on the session before preparing: the repositories
 * chosen for the project and the slug. Existing snapshots win, so retries repeat the request.
 */
export function sessionWorktreeSnapshot(session: Session): {
  worktreeRepositories: string[];
  worktreeSlug: string;
} {
  return {
    worktreeRepositories: session.worktreeRepositories ?? loadProjectRepositoryChoice(session.cwd),
    worktreeSlug: session.worktreeSlug ?? session.title,
  };
}

export type SessionWorkspaceResult = {
  workspace: ManagedWorkspace | null;
  outcome: SessionWorkspaceOutcome;
  /** Original extra folder to its worktree, both in the session's own path form. */
  extraWorktrees: Record<string, string>;
  baseSource?: WorkspaceBaseSource;
};

/**
 * The extra folders of a worktree session that are git repository roots, as Host paths, with
 * the session-form path each came from. Folders inside the primary project and folders that
 * are not the root of a repository stay live additional folders and are left out.
 */
export async function sessionRepositoryRoots(
  project: string,
  dirs: readonly string[],
): Promise<{ original: string; hostPath: string }[]> {
  const owner = parseRemotePath(project);
  const roots: { original: string; hostPath: string }[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (isEqualOrInside(dir, project) || seen.has(pathKey(dir))) continue;
    const remote = parseRemotePath(dir);
    if (owner && remote?.environmentId !== owner.environmentId) continue;
    let trees: Awaited<ReturnType<typeof listWorktrees>>["worktrees"];
    try {
      trees = (await listWorktrees(dir, { light: true })).worktrees;
    } catch (error) {
      if (errorText(error).toLowerCase().includes("not a git repository")) continue;
      throw new Error(
        t("Could not read the repository {p0}: {p1} Retry to continue.", {
          p0: dir,
          p1: errorText(error),
        }),
      );
    }
    const hostPath = remote?.hostPath ?? dir;
    const main = trees[0] ? (parseRemotePath(trees[0].path)?.hostPath ?? trees[0].path) : "";
    if (!main || pathKey(main) !== pathKey(hostPath)) continue;
    seen.add(pathKey(dir));
    roots.push({ original: dir, hostPath });
  }
  return roots;
}

/** Same as `prepareSessionWorkspace`, and also says whether a null workspace was a fallback. */
export async function prepareSessionWorkspaceDetailed(
  session: Session,
  managedCreationReady = true,
  options: PrepareSessionWorkspaceOptions = {},
): Promise<SessionWorkspaceResult> {
  const none = (outcome: SessionWorkspaceOutcome): SessionWorkspaceResult => ({
    workspace: null,
    outcome,
    extraWorktrees: {},
  });
  if (!needsSessionWorkspace(session)) return none("not-needed");
  const explicitWorktree = session.workspaceMode === "worktree";
  const owner = hostSessionBinding(session);
  const ownerContext = owner
    ? {
        cwd: session.cwd,
        environmentId: owner.environmentId,
        machineId: owner.machineId,
        projectId: owner.projectId,
        ownerProjectId: owner.projectId,
      }
    : undefined;
  let context: Awaited<ReturnType<typeof resolveWorkspaceContext>>;
  let policy: WorkspacePolicy;
  try {
    const read = async () => {
      const capabilities = await getWorkspaceCapabilities(ownerContext ?? { cwd: session.cwd });
      if (!capabilities.includes("workspaces.policy.v1") && !explicitWorktree) return null;
      const ctx = ownerContext ?? (await resolveWorkspaceContext(session.cwd));
      await requireWorkspaceCapability("workspaces.policy.v1", ctx);
      const { resolved } = await workspaceRequest(
        "projects.workspacePolicy.get",
        { projectId: ctx.projectId, environmentId: ctx.environmentId },
        ctx,
      );
      return { ctx, policy: resolved.policy };
    };
    // Only a definite "this Host has no policy capability" answer falls back to the
    // current checkout. A slow or failed read is a retryable error: silently using the
    // current checkout would bypass the project's worktree policy for the whole session.
    const result = await withTimeout(read(), POLICY_READ_TIMEOUT_MS, "Workspace policy read");
    if (!result) return none("fallback");
    context = result.ctx;
    policy = result.policy;
  } catch (error) {
    if (error instanceof TimeoutError)
      throw new Error(
        t("Reading this project's workspace policy is taking too long. Retry to continue."),
      );
    throw error;
  }
  const mode = workspaceModeForPolicy(session.workspaceMode, policy);
  if (mode === "current") return none("current");
  if (!managedCreationReady && !explicitWorktree) {
    console.warn("[workspaces] managed creation unavailable; using the current checkout");
    return none("fallback");
  }
  if (!managedCreationReady)
    throw new Error(t("Update bycoda to create managed sessions on this remote Host."));
  try {
    await requireWorkspaceCapability("workspaces.managed.v1", context);
  } catch (error) {
    // Only a definite missing capability on a legacy Host may use the current checkout.
    if (explicitWorktree || !(error instanceof WorkspaceCapabilityError)) throw error;
    console.warn("[workspaces] managed creation unavailable; using the current checkout", error);
    return none("fallback");
  }
  // Extra repositories and the remote base need a creation-v2 Host; without it `workspaceRequest`
  // raises the "Update bycoda…" error instead of silently dropping them.
  // The repositories chosen in the folders chip (remembered per project) each get a worktree.
  const snapshot = sessionWorktreeSnapshot(session);
  const roots = await sessionRepositoryRoots(session.cwd, snapshot.worktreeRepositories);
  const v2 = (await getWorkspaceCapabilities(context)).includes(WORKSPACE_CREATION_V2);
  // The idempotency key makes a retry recover the same workspace, so a stalled prepare is retryable.
  const { workspace, extraWorktrees, baseSource } = await withTimeout(
    workspaceRequest(
      "workspaces.prepare",
      {
        idempotencyKey: `session:${session.id}:workspace`,
        projectId: context.projectId,
        environmentId: context.environmentId,
        owner: { kind: "session", id: session.id },
        slug: snapshot.worktreeSlug,
        ...(session.workspaceMode ? { choice: { defaultMode: mode } } : {}),
        baseRef: session.worktreeBase || policy.integrationBranchRef,
        ...(roots.length > 0 ? { repositories: roots.map((root) => root.hostPath) } : {}),
        ...(session.worktreeBaseRemote ? { baseFromRemote: true } : {}),
        ...(v2 && options.progressId ? { progressId: options.progressId } : {}),
      },
      context,
    ),
    PREPARE_TIMEOUT_MS,
    "Workspace preparation",
  ).catch((error: unknown) => {
    if (error instanceof TimeoutError)
      throw new Error(
        t("Workspace preparation is incomplete. Retry to recover the same workspace."),
      );
    throw error;
  });
  if (
    workspace.owner.kind !== "session" ||
    workspace.owner.id !== session.id ||
    workspace.projectId !== context.projectId ||
    workspace.environmentId !== context.environmentId ||
    !workspace.path ||
    workspace.directoryState !== "present"
  ) {
    throw new Error(t("Workspace preparation is incomplete. Retry to recover the same workspace."));
  }
  // The Host answers in its own paths; the session keeps the original folders it picked.
  const remoteOwner = parseRemotePath(session.cwd);
  const mapped: Record<string, string> = {};
  for (const root of roots) {
    const path = extraWorktrees?.[root.hostPath];
    if (path)
      mapped[root.original] = remoteOwner ? remotePath(remoteOwner.environmentId, path) : path;
  }
  return { workspace, outcome: "workspace", extraWorktrees: mapped, baseSource };
}
