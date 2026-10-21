import { hasPendingApproval, type Block, type Session } from "../../sessions/model/session";
import { leafIds, type WorkspaceTab } from "./layout";

export type IdleTabInput = {
  tabs: readonly WorkspaceTab[];
  sessions: readonly Session[];
  activeTabId: string;
  busySessionIds: ReadonlySet<string>;
  /** Sessions that finished while unfocused and have not been looked at yet. */
  unseenFinishedIds: ReadonlySet<string>;
  dirtyFileIds: ReadonlySet<string>;
  movingTabIds?: ReadonlySet<string>;
  /** Unsent composer text or attachments for a session. */
  hasComposerDraft: (sessionId: string) => boolean;
};

/** Computed on every app render: rescan a transcript only when its blocks change. */
const blockActivity = new WeakMap<Block[], boolean>();
function hasLiveOrDraftBlock(blocks: Block[]): boolean {
  let active = blockActivity.get(blocks);
  if (active === undefined) {
    active = blocks.some(
      (block) =>
        block.streaming ||
        block.tool?.status === "in_progress" ||
        (block.role === "user" && !!block.draft),
    );
    blockActivity.set(blocks, active);
  }
  return active;
}

type SessionIdleInput = Pick<
  IdleTabInput,
  "busySessionIds" | "unseenFinishedIds" | "hasComposerDraft"
>;

/**
 * True when a session has no live work or waiting input. Mirrors the protected
 * checks in TranscriptPool, plus queued, background, draft and unseen state.
 */
export function sessionIsIdle(session: Session, input: SessionIdleInput): boolean {
  if (input.busySessionIds.has(session.id) || input.unseenFinishedIds.has(session.id)) return false;
  if (session.busy || session.continuingElsewhere) return false;
  if (session.pendingQuestion || hasPendingApproval(session.blocks)) return false;
  if ((session.backgroundTasks?.length ?? 0) > 0 || (session.backgroundAgents ?? 0) > 0)
    return false;
  if ((session.queuedMessages?.length ?? 0) > 0) return false;
  if (hasLiveOrDraftBlock(session.blocks)) return false;
  return !input.hasComposerDraft(session.id);
}

/**
 * Tab ids that can be closed silently: not the active or moving tab, every
 * session idle, and no dirty files or terminal panes (which would prompt).
 */
export function idleWorkspaceTabIds(input: IdleTabInput): string[] {
  const sessions = new Map(input.sessions.map((session) => [session.id, session]));
  return input.tabs
    .filter((tab) => {
      if (tab.id === input.activeTabId || input.movingTabIds?.has(tab.id)) return false;
      if (tab.terminalPanes?.length) return false;
      const files = [...tab.editorPanes, ...(tab.terminalPanes ?? [])].flatMap((pane) => pane.files);
      if (files.some((file) => file.terminal || input.dirtyFileIds.has(file.id))) return false;
      const ids = leafIds(tab.layout);
      return (
        ids.length > 0 &&
        ids.every((id) => {
          const session = sessions.get(id);
          return session !== undefined && sessionIsIdle(session, input);
        })
      );
    })
    .map((tab) => tab.id);
}
