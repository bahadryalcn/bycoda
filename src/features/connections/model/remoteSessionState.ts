import type { Session } from "../../sessions/model/session";
import type { HostSession } from "./protocol";
import { parseRemotePath, remotePath, type RemoteProject } from "./remoteProjects";

/** Show the host's conversation in the app's ordinary session state while
 * retaining the local tab ID and the project's remote path. */
export function remoteSessionState(
  shell: Session,
  snapshot: HostSession,
  project: RemoteProject,
): Session {
  const host = snapshot.session;
  const executionCwd = host.worktreeCwd || (host.cwd !== project.cwd ? host.cwd : undefined);
  return {
    ...shell,
    ...host,
    id: shell.id,
    cwd: shell.cwd,
    busy: snapshot.status === "running",
    historyPartial:
      snapshot.history?.before !== undefined || host.blocks.some((block) => !!block.remoteContent),
    worktreeCwd: executionCwd
      ? remotePath(project.environmentId, parseRemotePath(executionCwd)?.hostPath ?? executionCwd)
      : undefined,
    worktreeRemoved: host.worktreeRemoved || (!!host.workspaceId && !executionCwd),
  };
}
