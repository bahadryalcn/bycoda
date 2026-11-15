import type { Session } from "../../sessions";
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
  return keepUnchangedFields(shell, {
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
  });
}

/**
 * `next` with each non-block field that equals `previous`'s by value keeping
 * `previous`'s object. Every host sync parses fresh objects (settings, binding,
 * usage), so without this a streamed-text delta fails `isTextOnlyChange` and
 * re-renders the whole workspace shell.
 */
export function keepUnchangedFields(previous: Session, next: Session): Session {
  const kept: Record<string, unknown> = { ...next };
  const before = previous as Record<string, unknown>;
  for (const key of Object.keys(kept)) {
    if (key === "blocks") continue;
    const a = before[key];
    const b = kept[key];
    if (
      !Object.is(a, b) &&
      typeof a === "object" &&
      typeof b === "object" &&
      a !== null &&
      b !== null &&
      JSON.stringify(a) === JSON.stringify(b)
    )
      kept[key] = a;
  }
  return kept as Session;
}
