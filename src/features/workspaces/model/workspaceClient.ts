import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { backgroundMachineFor, hostProjectFor } from "../../automations/model/hostAutomationClient";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import { remoteRequest } from "../../connections/model/connections";
import type { RemoteMachine } from "../../connections/model/protocol";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import type { WorkspaceRpcContract, WorkspaceRpcMethod } from "./contracts";

export type WorkspaceRpcParams = { [K in WorkspaceRpcMethod]: WorkspaceRpcContract[K]["request"] };
export type WorkspaceRpcResults = {
  [K in WorkspaceRpcMethod]: WorkspaceRpcContract[K]["response"];
};
export type WorkspaceContext = { cwd?: string; environmentId?: string };
export const WORKSPACE_UPDATE_REQUIRED =
  "Update bycoda Host on this project's machine to use managed workspaces. Your project checkout will not be used as a fallback.";

/** Stable classification for UI recovery actions, independent of translated copy. */
export class WorkspaceCapabilityError extends Error {
  constructor() {
    super(t(WORKSPACE_UPDATE_REQUIRED));
    this.name = "WorkspaceCapabilityError";
  }
}

const requiredCapability = (method: WorkspaceRpcMethod): string => {
  if (method.startsWith("projects.workspacePolicy.")) return "workspaces.policy.v1";
  if (method === "sessions.rewind.undo") return "sessions.git-rewind-undo.v1";
  if (method.startsWith("sessions.rewind.")) return "sessions.git-rewind.v1";
  if (method === "workspaces.delivery.publish") return "workspaces.pr-publication.v1";
  if (method.startsWith("workspaces.delivery.")) return "workspaces.delivery.v1";
  if (method.startsWith("workspaces.cleanup.") || method === "workspaces.storage.status")
    return "workspaces.lifecycle.v1";
  return "workspaces.managed.v1";
};

async function owningMachine(context: WorkspaceContext): Promise<RemoteMachine> {
  const remote = context.cwd && parseRemotePath(context.cwd);
  const environmentId = remote ? remote.environmentId : context.environmentId;
  if (!remote && !environmentId) {
    const local = await invoke<RemoteMachine | null>("local_host_connect");
    if (local) return local;
  }
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = environmentId
    ? machines.find((entry) => entry.environmentId === environmentId)
    : context.cwd
      ? backgroundMachineFor(machines, context.cwd)
      : undefined;
  if (!machine) throw new Error(t("This project's machine is not connected. Reconnect and retry."));
  return machine;
}

/** Resolve on the execution host. A path is never substituted for a project ID. */
export async function resolveWorkspaceContext(cwd: string) {
  if (!cwd.trim() || cwd === "~") throw new Error(t("Choose a project to use managed workspaces."));
  const machine = await owningMachine({ cwd });
  const project = await hostProjectFor(machine, cwd);
  return {
    cwd,
    projectId: project.id,
    environmentId: machine.environmentId,
    machineId: machine.id,
  };
}

export async function getWorkspaceCapabilities(context: WorkspaceContext = {}): Promise<string[]> {
  return machineCapabilities(await owningMachine(context));
}

export async function requireWorkspaceCapability(
  capability: string,
  context: WorkspaceContext = {},
) {
  if (!(await getWorkspaceCapabilities(context)).includes(capability))
    throw new WorkspaceCapabilityError();
}

/** Owner UI calls use the paired authenticated transport. No mutation is retried here. */
export async function workspaceRequest<K extends WorkspaceRpcMethod>(
  method: K,
  params: WorkspaceRpcParams[K],
  context: WorkspaceContext = {},
): Promise<WorkspaceRpcResults[K]> {
  const machine = await owningMachine(context);
  const capabilities = await machineCapabilities(machine);
  if (!capabilities.includes(requiredCapability(method))) throw new WorkspaceCapabilityError();
  // A publish review is meaningful only when the same host can publish it.
  if (
    method === "workspaces.delivery.review" &&
    "action" in params &&
    params.action === "publish" &&
    !capabilities.includes("workspaces.pr-publication.v1")
  )
    throw new WorkspaceCapabilityError();
  let input: Record<string, unknown> = { ...params };
  if (context.cwd && "projectId" in input) {
    const project = await hostProjectFor(machine, context.cwd);
    input = { ...input, projectId: project.id };
  }
  if ("environmentId" in input) input.environmentId = machine.environmentId;
  if (
    machine.localHost &&
    (method === "workspaces.cleanup.plan" || method === "workspaces.cleanup.apply")
  )
    return invoke<WorkspaceRpcResults[K]>(
      method === "workspaces.cleanup.plan"
        ? "managed_worktree_removal_plan"
        : "managed_worktree_removal_apply",
      { request: input },
    );
  return remoteRequest<WorkspaceRpcResults[K]>(machine.id, method, input, false, true);
}

export function workspaceOperationKey() {
  return crypto.randomUUID();
}
