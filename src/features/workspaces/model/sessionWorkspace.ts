import type { Session, WorkspaceMode } from "../../sessions/model/session";
import { t } from "../../../shared/i18n";
import type { ManagedWorkspace, WorkspacePolicy } from "./contracts";
import {
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
    (session.workspaceMode === "worktree" || isNewWorkspaceSession(session))
  );
}

export function workspaceModeForPolicy(
  choice: WorkspaceMode | undefined,
  policy: WorkspacePolicy,
): WorkspaceMode {
  return choice ?? policy.defaultMode;
}

export async function prepareSessionWorkspace(
  session: Session,
  managedCreationReady = true,
): Promise<ManagedWorkspace | null> {
  if (!needsSessionWorkspace(session)) return null;
  const capabilities = await getWorkspaceCapabilities({ cwd: session.cwd });
  if (!capabilities.includes("workspaces.policy.v1") && session.workspaceMode !== "worktree")
    return null;
  const context = await resolveWorkspaceContext(session.cwd);
  await requireWorkspaceCapability("workspaces.policy.v1", context);
  const { resolved } = await workspaceRequest(
    "projects.workspacePolicy.get",
    {
      projectId: context.projectId,
      environmentId: context.environmentId,
    },
    context,
  );
  const mode = workspaceModeForPolicy(session.workspaceMode, resolved.policy);
  if (mode === "current") return null;
  if (!managedCreationReady)
    throw new Error(t("Update bycoda to create managed sessions on this remote Host."));
  await requireWorkspaceCapability("workspaces.managed.v1", context);
  const { workspace } = await workspaceRequest(
    "workspaces.prepare",
    {
      idempotencyKey: `session:${session.id}:workspace`,
      projectId: context.projectId,
      environmentId: context.environmentId,
      owner: { kind: "session", id: session.id },
      slug: session.title,
      ...(session.workspaceMode ? { choice: { defaultMode: mode } } : {}),
      baseRef: session.worktreeBase || resolved.policy.integrationBranchRef,
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
  return workspace;
}
