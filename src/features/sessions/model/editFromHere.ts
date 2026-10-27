import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import {
  remoteMachineFor,
  remoteRequest,
  remoteSessionFor,
} from "../../connections/model/connections";
import type { RemoteMachine } from "../../connections/model/protocol";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import type { Session } from "./session";

export const EDIT_FROM_HERE_CAPABILITY = "sessions.edit-from-here.v1";
export const EDIT_FROM_HERE_UPDATE_HINT =
  "Update bycoda Host on this machine to revert session files. You can still rewind and keep changes.";

export type SessionFilesRevertPlan = {
  authorityGeneration?: number;
  files: Array<{ path: string; action: "restore" | "delete"; conflict?: string }>;
  unavailable?: string;
  planToken?: string;
};
type FileRevertIntent = { authorityGeneration?: number };
type FileRevertRoute = { cwd: string; userBlockId: string; sessionId: string; machineId?: string };
const plannedRoutes = new WeakMap<SessionFilesRevertPlan, FileRevertRoute>();
function capturedAuthority(intent: FileRevertIntent): FileRevertIntent {
  const generation = intent.authorityGeneration;
  if (generation === undefined) return {};
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw new Error(t("The session authority changed. Review the file changes again."));
  return { authorityGeneration: generation };
}
function retainPlan(
  plan: SessionFilesRevertPlan,
  intent: FileRevertIntent,
  route: FileRevertRoute,
): SessionFilesRevertPlan {
  if (!plan || !Array.isArray(plan.files))
    throw new Error(t("Session file history is unavailable."));
  if (
    capturedAuthority(plan).authorityGeneration !== intent.authorityGeneration ||
    (intent.authorityGeneration !== undefined &&
      !plan.unavailable &&
      !/^[a-f0-9]{64}$/.test(plan.planToken ?? ""))
  )
    throw new Error(t("The session authority changed. Review the file changes again."));
  const retained = Object.freeze({ ...plan });
  plannedRoutes.set(retained, route);
  return retained;
}

export type SessionFilesRevertResult = {
  reverted: string[];
  skipped: Array<{ path: string; reason: string }>;
};

async function fileRevertTarget(session: Session, authorityGeneration?: number) {
  const hostSessionId = remoteSessionFor(session.id);
  const remote = parseRemotePath(session.cwd);
  if (!remote && !hostSessionId && authorityGeneration === undefined)
    return { machine: null, sessionId: session.id };
  const machine = remote
    ? await remoteMachineFor(remote.environmentId)
    : await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine) throw new Error(t("This project's machine is not connected. Reconnect and retry."));
  return { machine, sessionId: hostSessionId ?? session.id };
}

/** Only session-owned file history is requested; no Git rewind/snapshot is used. */
export async function planSessionFilesRevert(
  session: Session,
  userBlockId: string,
  intent?: FileRevertIntent,
): Promise<SessionFilesRevertPlan> {
  const captured = capturedAuthority(
    intent ?? { authorityGeneration: session.adoptedAuthorityGeneration },
  );
  const { machine, sessionId } = await fileRevertTarget(session, captured.authorityGeneration);
  const route = {
    cwd: session.cwd,
    userBlockId,
    sessionId,
    ...(machine ? { machineId: machine.id } : {}),
  };
  if (!machine) {
    const plan = await invoke<SessionFilesRevertPlan>("session_files_revert_plan", {
      sessionId,
      userBlockId,
    });
    return retainPlan(plan, captured, route);
  }
  if (!(await machineCapabilities(machine)).includes(EDIT_FROM_HERE_CAPABILITY))
    return { files: [], unavailable: t(EDIT_FROM_HERE_UPDATE_HINT) };
  const plan = await remoteRequest<SessionFilesRevertPlan>(
    machine.id,
    "sessions.files.revertPlan",
    { sessionId, userBlockId, ...captured },
    false,
    true,
  );
  return retainPlan(plan, captured, route);
}

/** Never retries a mutation: conflicts and already changed files belong to the server. */
export async function revertSessionFiles(
  session: Session,
  userBlockId: string,
  planToken?: string,
  review?: SessionFilesRevertPlan,
): Promise<SessionFilesRevertResult> {
  const captured = capturedAuthority(review ?? {});
  if (
    captured.authorityGeneration !==
      capturedAuthority({ authorityGeneration: session.adoptedAuthorityGeneration })
        .authorityGeneration ||
    (captured.authorityGeneration !== undefined &&
      (!review || review.planToken !== planToken || !/^[a-f0-9]{64}$/.test(planToken ?? "")))
  )
    throw new Error(t("The session authority changed. Review the file changes again."));
  const { machine, sessionId } = await fileRevertTarget(session, captured.authorityGeneration);
  const original = review && plannedRoutes.get(review);
  if (
    original &&
    (original.cwd !== session.cwd ||
      original.userBlockId !== userBlockId ||
      original.sessionId !== sessionId ||
      original.machineId !== machine?.id)
  )
    throw new Error(t("The session authority changed. Review the file changes again."));
  const request = {
    ...captured,
    sessionId,
    userBlockId,
    ...(planToken ? { planToken } : {}),
  };
  if (!machine) return invoke<SessionFilesRevertResult>("session_files_revert", request);
  if (!(await machineCapabilities(machine)).includes(EDIT_FROM_HERE_CAPABILITY))
    throw new Error(t(EDIT_FROM_HERE_UPDATE_HINT));
  return remoteRequest<SessionFilesRevertResult>(
    machine.id,
    "sessions.files.revert",
    request,
    false,
    true,
  );
}
