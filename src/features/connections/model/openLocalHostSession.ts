import type { Session } from "../../sessions/model/session";
import { sameProjectPath } from "../../projects/model/recents";
import { desktopCopyOf } from "./adoptedSessions";
import { isLocalSyncMachine } from "./localSync";
import type { HostProject, HostSession, RemoteMachine } from "./protocol";

export type LocalHostSessionTarget = {
  machineId: string;
  projectId: string;
  sessionId: string;
};

type OpenLocalHostSessionDeps = {
  machines: () => Promise<RemoteMachine[]>;
  projects: (machineId: string) => Promise<HostProject[]>;
  load: (machineId: string, sessionId: string) => Promise<HostSession>;
  find: (sessionId: string) => Promise<Session | null>;
  /** Creates only a missing copy. Refuses if storage or live state changed. */
  create: (session: Session) => Promise<boolean>;
  refresh: (sessionId: string, target: LocalHostSessionTarget) => Promise<unknown>;
};

/** Bring a host-owned conversation into the ordinary local session view.
 * The registered project owns the tab; an isolated task checkout stays its
 * worktree. A pre-existing local conversation uses the conflict-safe mirror. */
export async function openLocalHostSession(
  target: LocalHostSessionTarget,
  deps: OpenLocalHostSessionDeps,
): Promise<{ sessionId: string; cwd: string }> {
  const machine = (await deps.machines()).find((entry) => entry.id === target.machineId);
  if (!machine || !isLocalSyncMachine(machine))
    throw new Error("This conversation is not on this computer's host.");
  const project = (await deps.projects(machine.id)).find((entry) => entry.id === target.projectId);
  if (!project) throw new Error("This project is no longer on that machine.");
  const refresh = async (local: Session) => {
    if (!sameProjectPath(local.cwd, project.cwd))
      throw new Error("This conversation belongs to another project.");
    await deps.refresh(target.sessionId, target);
  };
  let local = await deps.find(target.sessionId);
  if (local) {
    await refresh(local);
  } else {
    // No local revision is a delta baseline for a conversation we haven't read.
    const host = await deps.load(machine.id, target.sessionId);
    if (host.session.id !== target.sessionId || host.projectId !== target.projectId)
      throw new Error("This conversation belongs to another project.");
    // It may have appeared while the full host snapshot was in flight.
    local = await deps.find(target.sessionId);
    if (local) await refresh(local);
    else if (!(await deps.create(desktopCopyOf(host, project.cwd, sameProjectPath)))) {
      local = await deps.find(target.sessionId);
      if (!local) throw new Error("Could not open this conversation. Try again.");
      await refresh(local);
    }
  }
  return { sessionId: target.sessionId, cwd: project.cwd };
}
