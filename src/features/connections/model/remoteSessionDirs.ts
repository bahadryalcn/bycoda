import { providerAdditionalDirsForSession } from "../../projects/public/additionalDirs";
import { parseRemotePath } from "./remoteProjects";

/**
 * The extra folders to send with a turn on another machine: the session's choices as paths on
 * that machine, with a worktree made for a folder in its place. Folders of other machines are
 * dropped; the Host validates the rest.
 */
export function remoteSessionAdditionalDirs(sessionId: string, projectKey: string): string[] {
  const owner = parseRemotePath(projectKey);
  if (!owner) return [];
  return providerAdditionalDirsForSession(sessionId, projectKey).flatMap((dir) => {
    const remote = parseRemotePath(dir);
    return remote?.environmentId === owner.environmentId ? [remote.hostPath] : [];
  });
}
