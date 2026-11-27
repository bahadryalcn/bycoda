import { useEffect, useSyncExternalStore } from "react";
import {
  cachedRemoteCapabilities,
  loadRemoteCapabilities,
  subscribeRemoteCapabilities,
  useRemoteMachines,
} from "./connections";
import { isLocalSyncMachine } from "./localSync";
import { providerSteerCapability } from "./protocol";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { parseRemotePath } from "./remoteProjects";

/** Branches, tags, remotes, stashes, history rewriting, conflicts and blame
 * (host/git/git-actions.ts). */
export const GIT_ACTIONS = "git.actions";

/** Reading the three versions of a conflicted file (host/git/git-conflicts.ts). */
export const GIT_CONFLICTS = "git.conflicts";

/** Running a `!command` from the composer in a host session (host/execution/shell.ts). */
export const SESSION_SHELL = "sessions.shell";
export const SESSION_REWIND = "sessions.rewind";
export const SESSION_PROVIDER_ACCOUNT = "sessions.configure.providerAccount.v1";

/** Shown where a feature stays off because the machine's host predates it. */
export const HOST_UPDATE_NOTICE =
  "Update bycoda Host in Machines settings to use this on projects on another machine.";

/** Whether the machine behind `cwd` advertises `capability`: always true for a
 * project on this computer, and undefined until a remote machine has answered. */
export function remoteSupports(cwd: string, capability: string): boolean | undefined {
  const remote = parseRemotePath(cwd);
  if (!remote) return true;
  return cachedRemoteCapabilities(remote.environmentId)?.includes(capability);
}

/** For actions on a project that may be on another machine: resolves when its
 * host supports `capability`, asking the machine if needed, and otherwise
 * rejects with what to do about it. */
export async function requireRemoteSupport(cwd: string, capability: string): Promise<void> {
  const remote = parseRemotePath(cwd);
  if (!remote) return;
  const capabilities =
    cachedRemoteCapabilities(remote.environmentId) ??
    (await loadRemoteCapabilities(remote.environmentId));
  if (!capabilities) throw new Error("This project’s machine isn’t connected on this computer.");
  if (!capabilities.includes(capability)) throw new Error(HOST_UPDATE_NOTICE);
}

/** `remoteSupports`, kept current: it asks the machine once when it does not
 * know yet, and again after the machine comes back. */
export function useRemoteSupports(cwd: string, capability: string): boolean | undefined {
  const environmentId = parseRemotePath(cwd)?.environmentId;
  const capabilities = useEnvironmentCapabilities(environmentId);
  return environmentId ? capabilities?.includes(capability) : true;
}

/** An adopted turn executes on this machine's Host, whose adapters may predate the desktop. */
export function useAdoptedSteerSupport(provider: string | undefined): boolean | undefined {
  const { machines } = useRemoteMachines(!!provider);
  const environmentId = provider ? machines.find(isLocalSyncMachine)?.environmentId : undefined;
  const capabilities = useEnvironmentCapabilities(environmentId);
  return provider ? !!capabilities?.includes(providerSteerCapability(provider)) : undefined;
}

function useEnvironmentCapabilities(environmentId: string | undefined) {
  const read = () => (environmentId ? cachedRemoteCapabilities(environmentId) : undefined);
  const capabilities = useSyncExternalStore(subscribeRemoteCapabilities, read, read);
  // Effect reason: refresh the serving Host's capability snapshot on attachment or recovery.
  useEffect(() => {
    if (!environmentId) return;
    const ask = () => void loadRemoteCapabilities(environmentId).catch(() => {});
    if (!cachedRemoteCapabilities(environmentId)) ask();
    return subscribeRemoteRecovered(() => {
      ask();
    });
  }, [environmentId]);
  return capabilities;
}
