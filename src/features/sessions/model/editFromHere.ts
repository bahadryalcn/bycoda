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
  files: Array<{ path: string; action: "restore" | "delete"; conflict?: string }>;
  unavailable?: string;
  planToken?: string;
};

export type SessionFilesRevertResult = {
  reverted: string[];
  skipped: Array<{ path: string; reason: string }>;
};

async function fileRevertTarget(session: Session) {
  const hostSessionId = remoteSessionFor(session.id);
  const remote = parseRemotePath(session.cwd);
  if (!remote && !hostSessionId) return { machine: null, sessionId: session.id };
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
): Promise<SessionFilesRevertPlan> {
  const { machine, sessionId } = await fileRevertTarget(session);
  if (!machine)
    return invoke<SessionFilesRevertPlan>("session_files_revert_plan", {
      sessionId,
      userBlockId,
    });
  if (!(await machineCapabilities(machine)).includes(EDIT_FROM_HERE_CAPABILITY))
    return { files: [], unavailable: t(EDIT_FROM_HERE_UPDATE_HINT) };
  return remoteRequest<SessionFilesRevertPlan>(
    machine.id,
    "sessions.files.revertPlan",
    { sessionId, userBlockId },
    false,
    true,
  );
}

/** Never retries a mutation: conflicts and already changed files belong to the server. */
export async function revertSessionFiles(
  session: Session,
  userBlockId: string,
  planToken?: string,
): Promise<SessionFilesRevertResult> {
  const { machine, sessionId } = await fileRevertTarget(session);
  const request = {
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
