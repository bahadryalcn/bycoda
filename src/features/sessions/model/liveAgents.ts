export { formatLiveElapsed, formatLiveMinutes } from "../../../shared/i18n/format";
import {
  DELEGATION_PARENT_KEY,
  decodeDelegationParent,
} from "../../../shared/model/host-contracts/delegation";
import { sessionIssue } from "./sessionIssue";
import { delegationParentOf, isDelegatedChildOf } from "./delegatedAgents";
import { sessionWait, type SessionWait } from "./sessionWait";
import { executionUserIndex } from "./executionTurn";
import { composeToolTitle } from "../../../integrations/harness/core/preview";
import { displayPath } from "../../../shared/lib/paths";
import {
  hasPendingApproval,
  sessionDisplayTitle,
  sessionNeedsInput,
  type Block,
  type HarnessId,
  type Session,
} from "./session";

export type LiveAgent = {
  /** Set only for a summary owned by another app window. */
  ownerWindowLabel?: string;
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  activity: string;
  startedAt?: number;
  durationMs?: number;
  needsApproval: boolean;
  /** Distinguishes a clarifying question from permission to run an action. */
  inputKind?: "approval" | "question";
  done: boolean;
  issue?: "retrying" | "failed";
  /** The agent yielded but work it started still runs; not counted as working. */
  waiting?: SessionWait;
};

/** Inbox discussions, orchestration workers and delegated children have their
 * own panels (or the parent's activity dock) and never appear as live agents. */
export function isLiveAgentSession(
  session: Pick<Session, "inboxAsk" | "orchestrationLeadId" | "modelSettings">,
): boolean {
  return (
    !session.inboxAsk &&
    !session.orchestrationLeadId &&
    !decodeDelegationParent(session.modelSettings?.[DELEGATION_PARENT_KEY])
  );
}

/** `waits`, when given, is the precomputed waiting map (it also carries Host wake sources). */
export function liveAgentsFromSessions(
  sessions: Session[],
  unseenFinishedIds: ReadonlySet<string> = new Set(),
  waits?: ReadonlyMap<string, SessionWait>,
): LiveAgent[] {
  const byParent = new Map<string, Session[]>();
  for (const session of sessions) {
    const parentId = delegationParentOf(session)?.parentSessionId;
    if (parentId) byParent.set(parentId, [...(byParent.get(parentId) ?? []), session]);
  }
  const waitOf = (session: Session): SessionWait | null =>
    waits
      ? (waits.get(session.id) ?? null)
      : sessionWait(
          session,
          (byParent.get(session.id) ?? []).filter((child) => isDelegatedChildOf(child, session)),
        );
  return sessions
    .map((session) => ({
      session,
      wait: isLiveAgentSession(session) ? waitOf(session) : null,
    }))
    .filter(
      ({ session, wait }) =>
        isLiveAgentSession(session) &&
        (isWorking(session) ||
          wait !== null ||
          sessionIssue(session) === "failed" ||
          unseenFinishedIds.has(session.id)),
    )
    .map(({ session, wait }) => toLiveAgent(session, unseenFinishedIds.has(session.id), wait))
    .sort(compareLiveAgents);
}

/** Keep the rail card up while a working or unseen-finished chat is not the open session. */
export function shouldShowLiveAgents(agents: LiveAgent[], activeSessionId?: string): boolean {
  return agents.some((agent) => agent.id !== activeSessionId);
}

/** Project activity includes host-owned turns, but excludes finished or waiting chats. */
export function workingProjectPaths(agents: readonly LiveAgent[]): string[] {
  return [
    ...new Set(
      agents
        .filter((agent) => !agent.done && !agent.needsApproval && !agent.waiting && agent.cwd)
        .map((agent) => agent.cwd),
    ),
  ];
}

function toLiveAgent(
  session: Session,
  unseenFinished: boolean,
  wait: SessionWait | null,
): LiveAgent {
  const issue = sessionIssue(session);
  const pending = hasPendingApproval(session.blocks)
    ? session.blocks.find((block) => block.approval && !block.approval.decided)
    : undefined;
  const pendingQuestion = session.pendingQuestion;
  const done = (unseenFinished || issue === "failed") && !isWorking(session) && !(wait && !issue);
  const activityBlock = pending ?? lastActivityBlock(session.blocks);
  return {
    id: session.id,
    cwd: session.cwd,
    title: sessionDisplayTitle(session.title, session.harness),
    harness: session.harness,
    issue,
    activity: issue
      ? issue === "retrying"
        ? "Retrying"
        : "Failed"
      : done
        ? "Done"
        : pendingQuestion
          ? pendingQuestion.title || pendingQuestion.questions[0]?.prompt || "Question"
          : session.continuingElsewhere
            ? "Working on host"
            : activityLabel(activityBlock, session.cwd),
    startedAt: turnStartedAt(session.blocks),
    durationMs: done ? turnDurationMs(session.blocks) : undefined,
    needsApproval: Boolean(pending) || Boolean(pendingQuestion),
    inputKind: pendingQuestion ? "question" : pending ? "approval" : undefined,
    done,
    waiting: wait && !done && !issue && !pending && !pendingQuestion ? wait : undefined,
  };
}

/** Display activity for both local turns and turns owned by a host. */
function isWorking(session: Session): boolean {
  return (
    !session.worktreeRemoved &&
    (!!session.busy || !!session.continuingElsewhere || sessionNeedsInput(session))
  );
}

function compareLiveAgents(a: LiveAgent, b: LiveAgent): number {
  if (!!a.issue !== !!b.issue) return a.issue ? -1 : 1;
  if (a.needsApproval !== b.needsApproval) return a.needsApproval ? -1 : 1;
  if (!!a.waiting !== !!b.waiting && !a.done && !b.done) return a.waiting ? 1 : -1;
  if (a.done !== b.done) return a.done ? 1 : -1;
  return (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER);
}

function lastActivityBlock(blocks: Block[]): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "tool" || block.role === "approval") return block;
    if (block.role === "handoff" && block.handoff?.status === "preparing") {
      return block;
    }
  }
  return undefined;
}

function turnStartedAt(blocks: Block[]): number | undefined {
  return blocks[executionUserIndex(blocks)]?.startedAt;
}

function turnDurationMs(blocks: Block[]): number | undefined {
  return blocks[executionUserIndex(blocks)]?.durationMs;
}

function activityLabel(block: Block | undefined, cwd: string): string {
  if (!block) return "Working";
  if (block.role === "handoff" && block.handoff?.status === "preparing") {
    return "Preparing a handoff";
  }
  const preview = block.tool?.preview;
  const path = preview?.path ? displayPath(preview.path, cwd) : preview?.fileName;
  return (
    composeToolTitle({
      kind: block.tool?.kind,
      title: block.text || block.tool?.title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd,
    }) || "Working"
  );
}
