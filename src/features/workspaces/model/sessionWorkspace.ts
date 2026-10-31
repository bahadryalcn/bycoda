import type { Session, WorkspaceMode } from "../../sessions/model/session";
import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { t } from "../../../shared/i18n";
import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import type { ManagedWorkspace, WorkspacePolicy } from "./contracts";
import {
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
  return (
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

/** Bound for the capability/policy reads that gate a new session's first Send. */
const POLICY_READ_TIMEOUT_MS = 10_000;

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
): Promise<ManagedWorkspace | null> {
  return (await prepareSessionWorkspaceDetailed(session, managedCreationReady)).workspace;
}

/** Same as `prepareSessionWorkspace`, and also says whether a null workspace was a fallback. */
export async function prepareSessionWorkspaceDetailed(
  session: Session,
  managedCreationReady = true,
): Promise<{ workspace: ManagedWorkspace | null; outcome: SessionWorkspaceOutcome }> {
  const none = (outcome: SessionWorkspaceOutcome) => ({ workspace: null, outcome });
  if (!needsSessionWorkspace(session)) return none("not-needed");
  const explicitWorktree = session.workspaceMode === "worktree";
  const owner = hostSessionBinding(session);
  const ownerContext = owner ? { cwd: session.cwd, environmentId: owner.environmentId, machineId: owner.machineId, projectId: owner.projectId, ownerProjectId: owner.projectId } : undefined;
  let context: Awaited<ReturnType<typeof resolveWorkspaceContext>>;
  let policy: WorkspacePolicy;
  try {
    const read = async () => {
      const capabilities = await getWorkspaceCapabilities(ownerContext ?? { cwd: session.cwd });
      if (!capabilities.includes("workspaces.policy.v1") && !explicitWorktree) return null;
      const ctx = ownerContext ?? await resolveWorkspaceContext(session.cwd);
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
  const { workspace } = await workspaceRequest(
    "workspaces.prepare",
    {
      idempotencyKey: `session:${session.id}:workspace`,
      projectId: context.projectId,
      environmentId: context.environmentId,
      owner: { kind: "session", id: session.id },
      slug: session.title,
      ...(session.workspaceMode ? { choice: { defaultMode: mode } } : {}),
      baseRef: session.worktreeBase || policy.integrationBranchRef,
    },
    context,
  );
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
  return { workspace, outcome: "workspace" };
}
