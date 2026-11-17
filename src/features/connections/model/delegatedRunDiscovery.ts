import type { Session } from "../../sessions";
import { sessionDelegationParent } from "../../../shared/model/host-contracts/delegation";
import type { HostSession, HostSessionSummary, RemoteMachine } from "./protocol";
import { desktopCopyOf } from "./adoptedSessions";
import { sameProjectPath } from "../../projects/public/recents";
import { isLocalSyncMachine } from "./localSync";
import {
  hostSessionBinding,
  saveHostSessionBinding,
  flushHostSessionBindings,
} from "./sessionExecutionBinding";
import { remoteSessionFor, remoteShellBoundTo, rememberRemoteSession } from "./connections";

export type DelegatedDiscoveryPort = {
  host(cwd: string): Promise<{ machine: RemoteMachine; projectId: string }>;
  list(
    machineId: string,
    projectId: string,
    parentSessionId: string,
  ): Promise<HostSessionSummary[]>;
  read(machineId: string, id: string, known?: HostSession): Promise<HostSession>;
};

/**
 * Internal hydration only: callers never open a tab or change active selection.
 * A subagent's own subagents (one level, the Host's limit) are read too: while
 * it runs on every poll, once more after `nestedListed` last saw it.
 */
export async function discoverDelegatedRuns(
  parent: Session,
  port: DelegatedDiscoveryPort,
  known: Map<string, HostSession>,
  isCurrent: () => boolean,
  nestedListed: Set<string> = new Set(),
): Promise<Session[]> {
  const binding = hostSessionBinding(parent);
  const hostParentId = binding?.sessionId ?? remoteSessionFor(parent.id) ?? parent.id;
  const { machine, projectId } = await port.host(parent.cwd);
  if (
    binding &&
    (machine.environmentId !== binding.environmentId ||
      machine.id !== binding.machineId ||
      projectId !== binding.projectId)
  )
    throw new Error(
      "The parent conversation's Host changed. Reconnect before loading its subagents.",
    );
  const children: Session[] = [];
  const nested: { id: string; running: boolean }[] = [];
  const adopt = async (ownerId: string): Promise<boolean> => {
    const summaries = await port.list(machine.id, projectId, ownerId);
    for (const summary of summaries) {
      if (!isCurrent()) return false;
      const host = await port.read(machine.id, summary.id, known.get(summary.id));
      if (!isCurrent()) return false;
      // Remembered before the filter: a listed session that is not this parent's child
      // is still asked for by revision on the next poll, never as a full snapshot again.
      known.set(summary.id, host);
      const link = sessionDelegationParent(host.session);
      if (host.projectId !== projectId || link?.parentSessionId !== ownerId) continue;
      children.push(await adoptChild(host));
      // A subagent that yielded while its own subagents run still changes.
      const running =
        host.status === "running" ||
        [...known.values()].some(
          (other) =>
            other.status === "running" &&
            sessionDelegationParent(other.session)?.parentSessionId === host.session.id,
        );
      if (ownerId === hostParentId && link.kind === "subagent") {
        if (running || !nestedListed.has(host.session.id))
          nested.push({ id: host.session.id, running });
      }
    }
    return true;
  };
  const adoptChild = async (host: HostSession): Promise<Session> => {
    let child = desktopCopyOf(host, parent.cwd, sameProjectPath);
    // Unlike a generic adopted history copy, the parent's live child needs its
    // current input requests. Copy them so local UI state cannot mutate Host data.
    child.pendingQuestion = host.session.pendingQuestion
      ? structuredClone(host.session.pendingQuestion)
      : undefined;
    child.submittedQuestions = host.session.submittedQuestions
      ? structuredClone(host.session.submittedQuestions)
      : undefined;
    if (isLocalSyncMachine(machine)) {
      child = saveHostSessionBinding(child, {
        kind: "local-host",
        machineId: machine.id,
        environmentId: machine.environmentId,
        projectId,
        sessionId: host.session.id,
        authorityGeneration: host.authorityGeneration ?? null,
        created: true,
      });
      await flushHostSessionBindings(child.id);
    } else {
      const existing = remoteSessionFor(child.id);
      if (
        (existing && existing !== host.session.id) ||
        remoteShellBoundTo(host.session.id, child.id)
      )
        throw new Error("The delegated conversation is bound to another session.");
      if (!existing) rememberRemoteSession(child.id, host.session.id);
      if (remoteSessionFor(child.id) !== host.session.id)
        throw new Error("The delegated conversation binding could not be saved.");
    }
    // The pane groups by its local parent identity while all commands retain Host IDs.
    return child;
  };
  if (!(await adopt(hostParentId))) return [];
  for (const { id, running } of nested) {
    if (!(await adopt(id))) return [];
    if (!running) nestedListed.add(id);
  }
  return children;
}
