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

/** Internal hydration only: callers never open a tab or change active selection. */
export async function discoverDelegatedRuns(
  parent: Session,
  port: DelegatedDiscoveryPort,
  known: Map<string, HostSession>,
  isCurrent: () => boolean,
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
  const summaries = await port.list(machine.id, projectId, hostParentId);
  const children: Session[] = [];
  for (const summary of summaries) {
    if (!isCurrent()) return [];
    const host = await port.read(machine.id, summary.id, known.get(summary.id));
    if (!isCurrent()) return [];
    // Remembered before the filter: a listed session that is not this parent's child
    // is still asked for by revision on the next poll, never as a full snapshot again.
    known.set(summary.id, host);
    if (
      host.projectId !== projectId ||
      sessionDelegationParent(host.session)?.parentSessionId !== hostParentId
    )
      continue;
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
    children.push(child);
  }
  return children;
}
