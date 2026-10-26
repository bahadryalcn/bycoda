import type { Session } from "../../sessions/model/session";
import { invoke } from "@tauri-apps/api/core";
import { getSession, upsertSession } from "../../sessions/data/sessionStore";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { buildConversationReplay } from "../../sessions/model/conversationRewind";
import { t } from "../../../shared/i18n";
import type { HostSession } from "../../connections/model/protocol";
import { remoteRequest, remoteSessionFor } from "../../connections/model/connections";
import type { SessionRewindPlan, SessionRewindReceipt } from "./contracts";
import {
  getWorkspaceCapabilities,
  resolveWorkspaceContext,
  workspaceRequest,
} from "./workspaceClient";

export async function planWorkspaceRewind(
  session: Session,
  workspaceId: string,
  target: { userBlockId: string } | { operationId: string },
): Promise<SessionRewindPlan> {
  const context = { cwd: session.cwd };
  const native = !parseRemotePath(session.cwd) && !remoteSessionFor(session.id);
  const capabilities = await getWorkspaceCapabilities(context);
  if (
    !capabilities.includes("sessions.git-rewind.v1") ||
    (native && !capabilities.includes("sessions.native-rewind.v1")) ||
    ("operationId" in target && !capabilities.includes("sessions.git-rewind-undo.v1"))
  )
    throw new Error(t("Update bycoda Host to rewind this workspace and conversation safely."));
  if (native) {
    const workspace = await workspaceRequest("workspaces.get", { workspaceId }, context);
    if (!workspace)
      throw new Error(
        t("The complete conversation could not be loaded. Retry the rewind preview."),
      );
    const persisted = await upsertSession({ ...session, workspaceRevision: workspace.revision });
    if (!persisted)
      throw new Error(
        t("The complete conversation could not be loaded. Retry the rewind preview."),
      );
    const record = await invoke<{ transcriptRevision?: number } | null>("session_get", {
      sessionId: session.id,
    });
    if (!record || !Number.isSafeInteger(record.transcriptRevision))
      throw new Error(
        t("The complete conversation could not be loaded. Retry the rewind preview."),
      );
    return invoke<SessionRewindPlan>("managed_rewind_plan", {
      request: {
        workspaceId,
        sessionId: session.id,
        expectedRevision: workspace.revision,
        expectedConversationRevision: record.transcriptRevision,
        ...("operationId" in target
          ? { direction: "undo", operationId: target.operationId }
          : { direction: "rewind", userBlockId: target.userBlockId }),
      },
    });
  }
  const resolved = await resolveWorkspaceContext(session.cwd);
  const authoritativeSessionId = remoteSessionFor(session.id) ?? session.id;
  const [workspace, authoritative] = await Promise.all([
    workspaceRequest("workspaces.get", { workspaceId }, context),
    remoteRequest<HostSession | null>(
      resolved.machineId,
      "sessions.get",
      { sessionId: authoritativeSessionId },
      false,
      true,
    ),
  ]);
  if (!workspace || !authoritative || authoritative.history || authoritative.historyLoading)
    throw new Error(t("The complete conversation could not be loaded. Retry the rewind preview."));
  return workspaceRequest(
    "sessions.rewind.plan",
    {
      workspaceId,
      sessionId: authoritativeSessionId,
      expectedRevision: workspace.revision,
      expectedConversationRevision: authoritative.revision,
      ...("operationId" in target
        ? { direction: "undo" as const, operationId: target.operationId }
        : { direction: "rewind" as const, userBlockId: target.userBlockId }),
    },
    context,
  );
}

/** A receipt authorizes reconciliation, never a second provider/file revert. */
export async function applyWorkspaceRewind(
  session: Session,
  plan: SessionRewindPlan,
  idempotencyKey: string,
): Promise<{ receipt: SessionRewindReceipt; session: Session; snapshot?: HostSession }> {
  if (plan.blockers.length || plan.expiresAt <= Date.now())
    throw new Error(t("This rewind preview is blocked or expired. Refresh the preview."));
  const context = { cwd: session.cwd };
  const native = !parseRemotePath(session.cwd) && !remoteSessionFor(session.id);
  const mutation = {
    workspaceId: plan.workspaceId,
    expectedRevision: plan.expectedRevision,
    idempotencyKey,
    sessionId: plan.sessionId,
    expectedConversationRevision: plan.expectedConversationRevision,
    planToken: plan.token,
  };
  if (native) {
    const receipt = await invoke<SessionRewindReceipt>(
      plan.direction === "undo" ? "managed_rewind_undo" : "managed_rewind_apply",
      { request: mutation },
    );
    const authoritative = await getSession(session.id);
    const record = await invoke<{ transcriptRevision?: number } | null>("session_get", {
      sessionId: session.id,
    });
    if (!authoritative || record?.transcriptRevision !== receipt.conversationRevision)
      throw new Error(
        t(
          "Rewind was recorded, but the conversation has not synchronized. Reopen this session before continuing.",
        ),
      );
    return {
      receipt,
      session: {
        ...authoritative,
        providerSessionId: undefined,
        pendingContextReplay: buildConversationReplay(authoritative.blocks) || undefined,
        pendingSwitch: undefined,
        context: undefined,
        busy: false,
      },
    };
  }
  const receipt = await workspaceRequest(
    plan.direction === "undo" ? "sessions.rewind.undo" : "sessions.rewind.apply",
    mutation,
    context,
  );
  const resolved = await resolveWorkspaceContext(session.cwd);
  const authoritative = await remoteRequest<HostSession | null>(
    resolved.machineId,
    "sessions.get",
    { sessionId: plan.sessionId },
    false,
    true,
  );
  if (
    !authoritative ||
    authoritative.history ||
    authoritative.historyLoading ||
    authoritative.revision !== receipt.conversationRevision
  )
    throw new Error(
      t(
        "Rewind was recorded, but the conversation has not synchronized. Reopen this session before continuing.",
      ),
    );
  return {
    receipt,
    snapshot: authoritative,
    session: {
      ...session,
      ...authoritative.session,
      id: session.id,
      cwd: session.cwd,
      worktreeCwd: session.worktreeCwd,
      providerSessionId: undefined,
      pendingContextReplay: buildConversationReplay(authoritative.session.blocks) || undefined,
      pendingSwitch: undefined,
      context: undefined,
      busy: false,
    },
  };
}
