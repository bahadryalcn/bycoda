import { useEffect, useSyncExternalStore } from "react";
import {
  cachedRemoteCapabilities,
  loadRemoteCapabilities,
  subscribeRemoteCapabilities,
} from "./connections";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { parseRemotePath } from "./remoteProjects";

/** Branches, tags, remotes, stashes, history rewriting, conflicts and blame
 * (host/git-actions.ts). */
export const GIT_ACTIONS = "git.actions";

/** Reading the three versions of a conflicted file (host/git-conflicts.ts). */
export const GIT_CONFLICTS = "git.conflicts";

/** Running a `!command` from the composer in a host session (host/shell.ts). */
export const SESSION_SHELL = "sessions.shell";
export const SESSION_REWIND = "sessions.rewind";

/** Shown where a feature stays off because the machine's host predates it. */
export const HOST_UPDATE_NOTICE =
  "Update bycoda Host in Connections settings to use this on projects on another machine.";

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
  const read = () => (environmentId ? cachedRemoteCapabilities(environmentId) : undefined);
  const capabilities = useSyncExternalStore(subscribeRemoteCapabilities, read, read);
  useEffect(() => {
    if (!environmentId) return;
    const ask = () => void loadRemoteCapabilities(environmentId).catch(() => {});
    if (!cachedRemoteCapabilities(environmentId)) ask();
    return subscribeRemoteRecovered(() => {
      if (!cachedRemoteCapabilities(environmentId)) ask();
    });
  }, [environmentId]);
  return environmentId ? capabilities?.includes(capability) : true;
}
