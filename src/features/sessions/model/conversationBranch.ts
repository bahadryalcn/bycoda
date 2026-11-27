import { hostSessionBinding, remoteSessionProject } from "../../connections/public/headless";
import { buildConversationReplay, replayResetFields } from "./conversationRewind";
import { sessionThroughTurn } from "./handoff";
import { formatSessionTitle, sessionDisplayTitle, type Block, type Session } from "./session";

/** Why a reply cannot be branched. Each code has one sentence in the UI. */
export type BranchBlockedReason =
  | "host"
  | "managed"
  | "removed"
  | "loading"
  | "approval"
  | "unavailable";

type BranchSource = Session & { managedWorkspaceId?: string };

/** Mark kept in a branch's title so it reads apart from its source in lists and tabs. */
export const BRANCH_TITLE_MARK = "↳";

/**
 * A branch continues in a fresh provider session fed by the retained transcript (the same replay a rewind uses), so no
 * provider has to resume from a cut history. It is refused where that cut is not exact or the new session could not own
 * its place: a Host-owned conversation, a managed workspace (one per session), a removed working copy, a transcript still
 * loading, or an open approval inside the part being kept.
 */
export function branchBlockedReason(
  session: BranchSource,
  turn: readonly Block[],
): BranchBlockedReason | undefined {
  if (session.inboxAsk || session.orchestrationLeadId) return "unavailable";
  if (hostSessionBinding(session) || remoteSessionProject(session) || session.continuingElsewhere)
    return "host";
  if (session.workspaceId || session.managedWorkspaceId || session.worktreePreparing)
    return "managed";
  if (session.worktreeRemoved) return "removed";
  if (session.historyPartial || session.historyLoading) return "loading";
  const lastId = turn[turn.length - 1]?.id;
  const end = lastId ? session.blocks.findIndex((block) => block.id === lastId) : -1;
  if (end < 0) return "unavailable";
  const kept = session.blocks.slice(0, end + 1);
  if (kept.some((block) => block.approval && !block.approval.decided)) return "approval";
  if (kept.some((block) => block.streaming)) return "unavailable";
  return undefined;
}

export function branchTitle(source: Pick<Session, "title" | "harness">): string {
  const display = sessionDisplayTitle(source.title, source.harness);
  const base = display === "New session" ? "" : display.replace(/^↳\s*/, "");
  return formatSessionTitle(source.harness, `${BRANCH_TITLE_MARK} ${base}`.trim());
}

/**
 * The branch of `source` through the end of `turn`: a new session in the same project and machine whose transcript is
 * the source's up to and including that reply, behind one origin row that links back. The source is never touched.
 * The provider binding is not carried over; the first message replays the retained transcript, exactly as after an
 * edit-from-here.
 */
export function branchSessionFromReply(
  source: BranchSource,
  turn: readonly Block[],
  id: string = crypto.randomUUID(),
): Session | undefined {
  if (branchBlockedReason(source, turn)) return undefined;
  const through = sessionThroughTurn(source, turn as Block[]);
  const retained = through.blocks
    .filter((block) => !block.draft)
    .map((block) => ({ ...block, providerTurnId: undefined }));
  const sourceTitle = sessionDisplayTitle(source.title, source.harness);
  const origin: Block = {
    id: crypto.randomUUID(),
    role: "system",
    // Plain-text fallback for surfaces that do not draw the origin row.
    text: `Branched from ${sourceTitle}`,
    branchOrigin: {
      sessionId: source.id,
      blockId: turn[turn.length - 1].id,
      title: sourceTitle,
    },
  };
  const replay = buildConversationReplay(retained);
  return {
    ...source,
    ...replayResetFields(replay),
    id,
    title: branchTitle(source),
    blocks: [origin, ...retained],
    busy: false,
    providerSessionId: undefined,
    rewindHistory: undefined,
    rewindHistoryTruncated: undefined,
    managedBy: undefined,
    hostBinding: undefined,
    automationId: undefined,
    linkedWorkItem: undefined,
    adoptedRunId: undefined,
    adoptedAuthorityGeneration: undefined,
    adoptedSyncConflict: undefined,
    adoptedDivergence: undefined,
    adoptedBase: undefined,
    providerGoal: undefined,
    handoffCard: undefined,
    inboxCard: undefined,
    noteCard: undefined,
    composerSeed: undefined,
    linkedWorkItemUpdateCard: undefined,
  };
}
