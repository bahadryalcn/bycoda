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

type RewindAuthority = { authorityGeneration?: number };
const plannedRoutes = new WeakMap<
  SessionRewindPlan,
  { native: boolean; cwd: string; sessionId: string }
>();
function authority(source: RewindAuthority): RewindAuthority {
  const generation = source.authorityGeneration;
  if (generation === undefined) return {};
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw new Error(t("The session authority changed. Refresh the rewind preview."));
  return { authorityGeneration: generation };
}
function retainPlan(
  plan: SessionRewindPlan,
  expected: RewindAuthority,
  route: { native: boolean; cwd: string; sessionId: string },
): SessionRewindPlan {
  if (
    authority(plan).authorityGeneration !== expected.authorityGeneration ||
    plan.sessionId !== route.sessionId
  )
    throw new Error(t("The session authority changed. Refresh the rewind preview."));
  const retained = Object.freeze({ ...plan });
  plannedRoutes.set(retained, route);
  return retained;
}

export async function planWorkspaceRewind(
  session: Session,
  workspaceId: string,
  target: { userBlockId: string } | { operationId: string },
  intent?: RewindAuthority,
): Promise<SessionRewindPlan> {
  // Capture before discovery/read awaits; absence is a legacy intent, never an
  // invitation to fill it from a fresher Host head.
  const expected = authority(intent ?? { authorityGeneration: session.adoptedAuthorityGeneration });
  const context = { cwd: session.cwd };
  const boundSessionId = remoteSessionFor(session.id);
  const native =
    expected.authorityGeneration === undefined && !parseRemotePath(session.cwd) && !boundSessionId;
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
    const plan = await invoke<SessionRewindPlan>("managed_rewind_plan", {
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
    return retainPlan(plan, expected, { native, cwd: session.cwd, sessionId: session.id });
  }
  const resolved = await resolveWorkspaceContext(session.cwd);
  const authoritativeSessionId = boundSessionId ?? session.id;
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
  if (authority(authoritative).authorityGeneration !== expected.authorityGeneration)
    throw new Error(t("The session authority changed. Refresh the rewind preview."));
  const plan = await workspaceRequest(
    "sessions.rewind.plan",
    {
      workspaceId,
      ...expected,
      sessionId: authoritativeSessionId,
      expectedRevision: workspace.revision,
      expectedConversationRevision: authoritative.revision,
      ...("operationId" in target
        ? { direction: "undo" as const, operationId: target.operationId }
        : { direction: "rewind" as const, userBlockId: target.userBlockId }),
    },
    context,
  );
  return retainPlan(plan, expected, {
    native,
    cwd: session.cwd,
    sessionId: authoritativeSessionId,
  });
}

/** A receipt authorizes reconciliation, never a second provider/file revert. */
export async function applyWorkspaceRewind(
  session: Session,
  plan: SessionRewindPlan,
  idempotencyKey: string,
  displayed?: RewindAuthority,
): Promise<{ receipt: SessionRewindReceipt; session: Session; snapshot?: HostSession }> {
  if (plan.blockers.length || plan.expiresAt <= Date.now())
    throw new Error(t("This rewind preview is blocked or expired. Refresh the preview."));
  const expected = authority(plan);
  const current = authority(
    displayed ?? { authorityGeneration: session.adoptedAuthorityGeneration },
  );
  if (expected.authorityGeneration !== current.authorityGeneration)
    throw new Error(t("The session authority changed. Refresh the rewind preview."));
  const context = { cwd: session.cwd };
  const boundSessionId = remoteSessionFor(session.id) ?? session.id;
  const native =
    expected.authorityGeneration === undefined &&
    !parseRemotePath(session.cwd) &&
    !remoteSessionFor(session.id);
  const route = plannedRoutes.get(plan);
  if (
    plan.sessionId !== boundSessionId ||
    (route &&
      (route.cwd !== session.cwd || route.native !== native || route.sessionId !== boundSessionId))
  )
    throw new Error(t("The session authority changed. Refresh the rewind preview."));
  const mutation = {
    ...expected,
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
    authoritative.revision !== receipt.conversationRevision ||
    authority(authoritative).authorityGeneration !== expected.authorityGeneration ||
    authority(receipt).authorityGeneration !== expected.authorityGeneration
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
      adoptedAuthorityGeneration: authoritative.authorityGeneration,
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
