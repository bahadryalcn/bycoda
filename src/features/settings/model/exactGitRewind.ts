import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/model/connections";
import type { RemoteMachine } from "../../connections/model/protocol";
import { t } from "../../../shared/i18n";

/** Execution-host policy, shared by native turns and Host-owned turns. */
async function exactGitRewindRequest(enabled?: boolean): Promise<boolean> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine) throw new Error(t("The local Host is unavailable. Reconnect and retry."));
  const response = await remoteRequest<{ enabled: boolean }>(
    machine.id,
    enabled === undefined ? "workspaces.exactGitRewind.get" : "workspaces.exactGitRewind.set",
    enabled === undefined ? {} : { enabled },
  );
  if (typeof response?.enabled !== "boolean")
    throw new Error(t("The local Host returned an invalid setting. Reconnect and retry."));
  return response.enabled;
}

/** Settings surfaces retain read failures so an unavailable policy is never shown as saved. */
export const loadExactGitRewind = () => exactGitRewindRequest();
export const saveExactGitRewind = (enabled: boolean) => exactGitRewindRequest(enabled);

/** An unavailable experimental feature must never block ordinary worktree execution. */
export async function getExactGitRewindEnabled(): Promise<boolean> {
  try {
    return await loadExactGitRewind();
  } catch {
    return false;
  }
}
