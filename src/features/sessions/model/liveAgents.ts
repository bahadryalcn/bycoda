import { sessionIssue } from "./sessionIssue";
import { composeToolTitle } from "../../../integrations/harness/core/preview";
import { displayPath } from "../../../shared/lib/paths";
import {
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
};

/** Inbox discussions and orchestration workers have their own panels and
 * never appear as live agents. */
export function isLiveAgentSession(
  session: Pick<Session, "inboxAsk" | "orchestrationLeadId">,
): boolean {
  return !session.inboxAsk && !session.orchestrationLeadId;
}

export function liveAgentsFromSessions(
  sessions: Session[],
  unseenFinishedIds: ReadonlySet<string> = new Set(),
): LiveAgent[] {
  return sessions
    .filter(
      (session) =>
        isLiveAgentSession(session) &&
        (isWorking(session) ||
          sessionIssue(session) === "failed" ||
          unseenFinishedIds.has(session.id)),
    )
    .map((session) => toLiveAgent(session, unseenFinishedIds.has(session.id)))
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
        .filter((agent) => !agent.done && !agent.needsApproval && agent.cwd)
        .map((agent) => agent.cwd),
    ),
  ];
}

export function formatLiveElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(1, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minRest = minutes % 60;
  return minRest ? `${hours}h ${minRest}m` : `${hours}h`;
}

function toLiveAgent(session: Session, unseenFinished: boolean): LiveAgent {
  const issue = sessionIssue(session);
  const pending = session.blocks.find((block) => block.approval && !block.approval.decided);
  const pendingQuestion = session.pendingQuestion;
  const done = (unseenFinished || issue === "failed") && !isWorking(session);
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
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user") return blocks[i].startedAt;
  }
  return undefined;
}

function turnDurationMs(blocks: Block[]): number | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user") return blocks[i].durationMs;
  }
  return undefined;
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
