import { invoke } from "@tauri-apps/api/core";
import { newDefaultSession, type RuntimeMode, type Session } from "../../sessions/model/session";
import { worktreeFocus } from "../../source-control/model/worktreeFocus";
import { isLocalProject } from "../../projects/model/recents";
import { remoteRequest, refreshRemoteMachines } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { HostDescriptor, HostProject, RemoteMachine } from "./protocol";
import { saveHostSessionBinding, flushHostSessionBindings } from "./sessionExecutionBinding";

export const NEW_LOCAL_HOST_SESSION = "bycoda:new-local-host-session";

/** Only the explicit project menu action calls this. Ordinary chats stay Native. */
export async function newLocalHostSession(
  cwd: string,
  runtimeMode?: RuntimeMode,
): Promise<Session> {
  await flushHostSessionBindings();
  if (!isLocalProject(cwd)) throw new Error("Choose a local project first.");
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine || !isLocalSyncMachine(machine))
    throw new Error("This computer's Host is unavailable.");
  const descriptor = await remoteRequest<HostDescriptor>(
    machine.id,
    "environment.describe",
    {},
    false,
    true,
    machine.environmentId,
  );
  if (
    descriptor.environmentId !== machine.environmentId ||
    !["sessions.createFirstTurn", "sessions.managedCreation.v1"].every((capability) =>
      descriptor.capabilities.includes(capability),
    )
  )
    throw new Error("Update this computer's Host before creating a Host conversation.");
  const project = await remoteRequest<HostProject>(
    machine.id,
    "projects.open",
    { cwd },
    false,
    true,
    machine.environmentId,
  );
  if (!project?.id || !project.cwd) throw new Error("The Host did not confirm this project.");
  const focus = worktreeFocus(cwd);
  const shell = {
    ...newDefaultSession(cwd, runtimeMode),
    ...(focus && focus.path !== cwd
      ? { worktreeCwd: focus.path, branch: focus.branch ?? undefined }
      : {}),
  };
  const bound = saveHostSessionBinding(shell, {
    kind: "local-host",
    machineId: machine.id,
    environmentId: machine.environmentId,
    projectId: project.id,
    sessionId: shell.id,
    authorityGeneration: null,
    created: false,
  });
  await flushHostSessionBindings();
  refreshRemoteMachines();
  return bound;
}
