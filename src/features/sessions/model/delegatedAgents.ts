import {
  CREW_MEMBER_KEY,
  DELEGATION_PARENT_KEY,
  decodeCrewMemberChild,
  decodeDelegationParent,
  type CrewMemberChild,
  type DelegationParent,
} from "../../../shared/model/host-contracts/delegation";
import type { DockAgent, DockAgentStatus } from "./activityDock";
import type { AgentStep, Block, Session } from "./session";
import { delegatedBlockId } from "./delegatedBlockId";
import { executionUserIndex } from "./executionTurn";
import { isSessionErrorBlock } from "./sessionIssue";
import { sessionIssue } from "./sessionIssue";
import { sessionNeedsInput } from "./session";
import { hostSessionBinding } from "../../connections/public/sessionExecutionBinding";
import { remoteSessionFor } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import {
  isStoppedBlock,
  isSubagentBlock,
  isToolBlock,
  subagentModelName,
  subagentName,
  subagentStatusLine,
  subagentStatusParts,
  toolCallLabel,
} from "./transcriptActivity";

/**
 * Cross-provider delegated runs are child sessions. They show in the parent's
 * activity dock like native subagents, and open in the same sheet, built from
 * `delegatedAgentBlock`.
 */

/** The parent link the Host wrote into a child's settings; display only. */
export function delegationParentOf(
  session: Pick<Session, "modelSettings">,
): DelegationParent | undefined {
  return decodeDelegationParent(session.modelSettings?.[DELEGATION_PARENT_KEY]);
}

/** The Crew member a delegated child runs (`crews.member.ask`); display only. */
export function crewMemberOf(session: Pick<Session, "modelSettings">): CrewMemberChild | undefined {
  return decodeCrewMemberChild(session.modelSettings?.[CREW_MEMBER_KEY]);
}

/**
 * Both sides must prove the same owner when a Host identity is involved. A
 * subagent may own subagents of its own (one level, the Host's limit); an
 * advisor never does.
 */
export function isDelegatedChildOf(child: Session, parent: Session): boolean {
  const link = delegationParentOf(child);
  if (!link || child.id === parent.id || delegationParentOf(parent)?.kind === "advisor")
    return false;
  try {
    const childBinding = hostSessionBinding(child);
    const parentBinding = hostSessionBinding(parent);
    if (!childBinding && !parentBinding) {
      if (parseRemotePath(child.cwd) || parseRemotePath(parent.cwd)) {
        const childRemote = remoteSessionFor(child.id);
        return (
          !!childRemote &&
          child.cwd === parent.cwd &&
          remoteSessionFor(parent.id) === link.parentSessionId &&
          childRemote !== link.parentSessionId
        );
      }
      return link.parentSessionId === parent.id && child.cwd === parent.cwd;
    }
    // A local Native parent delegates through the Host: discovery binds its children
    // to the Host, while their lineage names the parent's own id.
    if (childBinding && !parentBinding && !parseRemotePath(parent.cwd))
      return (
        link.parentSessionId === parent.id &&
        childBinding.sessionId !== parent.id &&
        child.cwd === parent.cwd
      );
    return (
      !!childBinding &&
      !!parentBinding &&
      childBinding.machineId === parentBinding.machineId &&
      childBinding.environmentId === parentBinding.environmentId &&
      childBinding.projectId === parentBinding.projectId &&
      parentBinding.sessionId === link.parentSessionId &&
      childBinding.sessionId !== parentBinding.sessionId
    );
  } catch {
    return false;
  }
}

/** Children of one parent, oldest first. */
export function delegatedChildren(sessions: readonly Session[], parentId: string): Session[] {
  const parent = sessions.find((session) => session.id === parentId);
  return sessions
    .filter((session) =>
      parent
        ? isDelegatedChildOf(session, parent)
        : !session.hostBinding && delegationParentOf(session)?.parentSessionId === parentId,
    )
    .sort(
      (a, b) => (delegationParentOf(a)?.startedAt ?? 0) - (delegationParentOf(b)?.startedAt ?? 0),
    );
}

/** A subagent's own subagents (`delegatedChildren` one level down), oldest first. */
export function nestedDelegatedChildren(
  sessions: readonly Session[],
  children: readonly Session[],
): Session[] {
  return children.flatMap((child) =>
    delegationParentOf(child)?.kind === "subagent" ? delegatedChildren(sessions, child.id) : [],
  );
}

/** Whether `session` is `root`'s child, or the child of one of `root`'s children. */
export function isDelegatedDescendantOf(
  session: Session,
  root: Session,
  sessions: readonly Session[],
): boolean {
  return (
    isDelegatedChildOf(session, root) ||
    sessions.some(
      (middle) => isDelegatedChildOf(session, middle) && isDelegatedChildOf(middle, root),
    )
  );
}

/**
 * Dock rows include earlier children so their panels remain accessible. `nested`
 * are the children's own subagents: one waiting on the user marks its parent's
 * row, since the parent's sheet is where its request is answered.
 */
export function delegatedDockAgents(
  children: readonly Session[],
  _turnStartedAt: number | undefined,
  nested: readonly Session[] = [],
): DockAgent[] {
  return children.map((child) => {
    const agent = delegatedDockAgent(child);
    const own = nested.filter((grandchild) => isDelegatedChildOf(grandchild, child));
    // A child whose subagent waits on the user is still in progress, even when
    // its own turn has yielded.
    const nestedNeedsInput = own.some(
      (grandchild) => delegatedStatus(grandchild) === "running" && sessionNeedsInput(grandchild),
    );
    return {
      ...agent,
      ...(nestedNeedsInput ? { needsInput: true, status: "running" as const } : {}),
      ...(own.length ? { nested: own.length } : {}),
    };
  });
}

export function delegatedStatus(child: Session): DockAgentStatus {
  if (child.busy || child.continuingElsewhere) return "running";
  if (sessionIssue(child) === "failed") return "failed";
  return isStopped(child) ? "stopped" : "done";
}

function delegatedDockAgent(child: Session): DockAgent {
  const block = delegatedAgentBlock(child);
  const member = crewMemberOf(child);
  const steps = block.agentRun?.steps ?? [];
  const status = delegatedStatus(child);
  const startedAt = block.agentRun?.startedAt;
  const endedAt = block.agentRun?.endedAt;
  return {
    blockId: delegatedBlockId(child.id),
    sessionId: child.id,
    harness: child.runningModelTarget?.harness ?? child.harness,
    providerAccountId: child.runningModelTarget?.providerAccountId ?? child.providerAccountId,
    ...(status === "running" && sessionNeedsInput(child) ? { needsInput: true } : {}),
    name: subagentName(block),
    ...(member ? { crewMember: member } : {}),
    kind: "agent",
    status,
    model: subagentModelName(block),
    detailParts: subagentStatusParts(block, steps),
    detail: subagentStatusLine(block, steps),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(block.agentRun?.round ? { round: block.agentRun.round } : {}),
  };
}

export { delegatedBlockId };

/**
 * Which round of the conversation the child is in: the Host counts one per brief
 * and each parent reply; without it, the child's own user turns tell.
 */
export function delegatedRound(child: Session): number {
  const hosted = delegationParentOf(child)?.round;
  const turns = child.blocks.filter(
    (block) => block.role === "user" && !block.internal && !block.continuationOf,
  ).length;
  return Math.max(hosted ?? 0, turns, 1);
}

/** Why a failed child failed: its error notice, else the Host's note on the link. */
export function delegatedFailureText(child: Session): string | undefined {
  for (let i = child.blocks.length - 1; i >= 0; i--) {
    const block = child.blocks[i];
    if (block.role === "user" && !block.draft) break;
    if (isSessionErrorBlock(block) && block.text.trim()) return block.text.trim();
  }
  const reason = child.usageLimit ? undefined : delegationParentOf(child)?.error?.trim();
  return reason || undefined;
}

/**
 * A tool-shaped block for a child session, so the subagent sheet renders it
 * exactly like a native run. Its steps are the child's own calls and prose.
 */
export function delegatedAgentBlock(child: Session): Block {
  const parent = delegationParentOf(child);
  const first = child.blocks.find((block) => block.role === "user");
  // The clock and steps belong to the latest round; earlier rounds are history.
  const latestIndex = executionUserIndex(child.blocks);
  const latest = child.blocks[latestIndex] ?? first;
  const steps: AgentStep[] = [];
  for (const block of latestIndex > 0 ? child.blocks.slice(latestIndex) : child.blocks) {
    if (block.internal) continue;
    if (isToolBlock(block)) {
      steps.push({
        id: block.id,
        kind: "tool",
        text: toolCallLabel(block),
        ...(isSubagentBlock(block)
          ? {
              toolKind: "subagent",
              agentRun: block.agentRun ?? { name: subagentName(block), steps: [] },
            }
          : block.tool?.kind
            ? { toolKind: block.tool.kind }
            : {}),
        ...(block.tool?.status ? { status: block.tool.status } : {}),
        ...(block.tool?.preview ? { preview: block.tool.preview } : {}),
      });
    } else if (block.role === "assistant" && block.text.trim()) {
      steps.push({ id: block.id, kind: "message", text: block.text });
    }
  }
  const startedAt = latest?.startedAt ?? parent?.startedAt;
  const ended =
    !child.busy && latest?.startedAt !== undefined && latest.durationMs !== undefined
      ? latest.startedAt + latest.durationMs
      : undefined;
  const round = delegatedRound(child);
  const status = child.busy || child.continuingElsewhere ? "running" : "completed";
  // Runs started before the task title was kept are named "Subagent · <model>";
  // recover their task line from the brief instead of repeating the model.
  const named = child.title && !/^(?:Subagent|Advisor) · /.test(child.title) ? child.title : "";
  const task = first?.text.match(/\n(?:Task|Question):\n(.+)/)?.[1]?.trim();
  const member = crewMemberOf(child);
  // A member's run is named for the member; its @handle leads the state line.
  const title =
    member?.name || named || task || (parent?.kind === "advisor" ? "Advisor" : "Subagent");
  return {
    id: delegatedBlockId(child.id),
    role: "tool",
    text: title,
    tool: {
      kind: "subagent",
      title,
      status: delegatedStatus(child) === "failed" ? "failed" : status,
    },
    agentRun: {
      name: title,
      ...(member?.handle ? { agentType: `@${member.handle}` } : {}),
      model: child.runningModelTarget?.model || child.model || parent?.model,
      ...(first?.text ? { prompt: first.text } : {}),
      steps,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(ended !== undefined ? { endedAt: ended } : {}),
      ...(round > 1 ? { round } : {}),
    },
  };
}

function isStopped(child: Session): boolean {
  const last = child.blocks[child.blocks.length - 1];
  return !!last && isStoppedBlock(last);
}
