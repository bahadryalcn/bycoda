import {
  DELEGATION_PARENT_KEY,
  decodeDelegationParent,
  type DelegationParent,
} from "../../../shared/model/host-contracts/delegation";
import type { DockAgent, DockAgentStatus } from "./activityDock";
import type { AgentStep, Block, Session } from "./session";
import { sessionIssue } from "./sessionIssue";
import { sessionNeedsInput } from "./session";
import {
  isStoppedBlock,
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

/** Children of one parent, oldest first. */
export function delegatedChildren(sessions: readonly Session[], parentId: string): Session[] {
  return sessions
    .filter((session) => delegationParentOf(session)?.parentSessionId === parentId)
    .sort(
      (a, b) => (delegationParentOf(a)?.startedAt ?? 0) - (delegationParentOf(b)?.startedAt ?? 0),
    );
}

/** Dock rows for the children of the parent's current turn. A child still working always shows. */
export function delegatedDockAgents(
  children: readonly Session[],
  turnStartedAt: number | undefined,
): DockAgent[] {
  return children
    .filter(
      (child) =>
        child.busy ||
        child.continuingElsewhere ||
        turnStartedAt === undefined ||
        (delegationParentOf(child)?.startedAt ?? 0) >= turnStartedAt,
    )
    .map(delegatedDockAgent);
}

function delegatedStatus(child: Session): DockAgentStatus {
  if (child.busy || child.continuingElsewhere) return "running";
  if (sessionIssue(child) === "failed") return "failed";
  return isStopped(child) ? "stopped" : "done";
}

function delegatedDockAgent(child: Session): DockAgent {
  const block = delegatedAgentBlock(child);
  const steps = block.agentRun?.steps ?? [];
  const status = delegatedStatus(child);
  const startedAt = block.agentRun?.startedAt;
  const endedAt = block.agentRun?.endedAt;
  return {
    blockId: delegatedBlockId(child.id),
    sessionId: child.id,
    ...(status === "running" && sessionNeedsInput(child) ? { needsInput: true } : {}),
    name: subagentName(block),
    kind: "agent",
    status,
    model: subagentModelName(block),
    detailParts: subagentStatusParts(block, steps),
    detail: subagentStatusLine(block, steps),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
  };
}

export function delegatedBlockId(sessionId: string): string {
  return `delegated:${sessionId}`;
}

/**
 * A tool-shaped block for a child session, so the subagent sheet renders it
 * exactly like a native run. Its steps are the child's own calls and prose.
 */
export function delegatedAgentBlock(child: Session): Block {
  const parent = delegationParentOf(child);
  const first = child.blocks.find((block) => block.role === "user");
  const steps: AgentStep[] = [];
  for (const block of child.blocks) {
    if (block.internal) continue;
    if (isToolBlock(block)) {
      steps.push({
        id: block.id,
        kind: "tool",
        text: toolCallLabel(block),
        ...(block.tool?.kind ? { toolKind: block.tool.kind } : {}),
        ...(block.tool?.status ? { status: block.tool.status } : {}),
        ...(block.tool?.preview ? { preview: block.tool.preview } : {}),
      });
    } else if (block.role === "assistant" && block.text.trim()) {
      steps.push({ id: block.id, kind: "message", text: block.text });
    }
  }
  const startedAt = first?.startedAt ?? parent?.startedAt;
  const ended =
    !child.busy && first?.startedAt !== undefined && first.durationMs !== undefined
      ? first.startedAt + first.durationMs
      : undefined;
  const status = child.busy || child.continuingElsewhere ? "running" : "completed";
  const title = child.title || parent?.model || "Subagent";
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
      model: child.model || parent?.model,
      ...(first?.text ? { prompt: first.text } : {}),
      steps,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(ended !== undefined ? { endedAt: ended } : {}),
    },
  };
}

function isStopped(child: Session): boolean {
  const last = child.blocks[child.blocks.length - 1];
  return !!last && isStoppedBlock(last);
}
