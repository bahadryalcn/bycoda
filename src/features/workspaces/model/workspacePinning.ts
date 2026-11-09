import { remoteRequest } from "../../connections/model/connections";
import { t } from "../../../shared/i18n";
import type { ManagedWorkspace } from "./contracts";
import {
  requireWorkspaceCapability,
  resolveWorkspaceContext,
  workspaceOperationKey,
  type WorkspaceContext,
} from "./workspaceClient";

/** Optional S1 extension: pin changes never alter lifecycle or remove a directory. */
export const WORKSPACE_PINNING_CAPABILITY = "workspaces.pinning.v1";

export async function setWorkspacePinned(
  workspace: ManagedWorkspace,
  pinned: boolean,
  context: WorkspaceContext,
  idempotencyKey = workspaceOperationKey(),
): Promise<ManagedWorkspace> {
  await requireWorkspaceCapability(WORKSPACE_PINNING_CAPABILITY, context);
  if (!context.cwd) throw new Error(t("Choose the workspace project before changing pinning."));
  const resolved = await resolveWorkspaceContext(context.cwd);
  if (
    resolved.projectId !== workspace.projectId ||
    resolved.environmentId !== workspace.environmentId
  ) {
    throw new Error(t("This workspace belongs to a different execution project."));
  }
  return remoteRequest<ManagedWorkspace>(
    resolved.machineId,
    "workspaces.pin",
    {
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      idempotencyKey,
      pinned,
    },
    false,
    true,
  );
}
