import { hasPendingApproval, type Block, type Session } from "../../sessions/model/session";
import { isRemoteProjectPath, sameProjectPath } from "../../projects/model/recents";
import { leafIds, type WorkspaceTab } from "./layout";
import { workspaceTabCwd } from "./workspaceTabGroups";

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
 * True when a tab holds only idle sessions and no terminal, dirty or moving
 * state. Shared by the silent close and by tab hibernation, so both agree on
 * what is safe to release. Editor-only tabs fail here (their leaves are not
 * sessions), so they are never treated as idle.
 */
export function tabIsIdle(
  tab: WorkspaceTab,
  input: Omit<IdleTabInput, "tabs" | "activeTabId" | "sessions">,
  sessions: ReadonlyMap<string, Session>,
): boolean {
  if (input.movingTabIds?.has(tab.id)) return false;
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
}

/**
 * Tab ids that can be closed silently: not the active or moving tab, every
 * session idle, and no dirty files or terminal panes (which would prompt).
 */
export function idleWorkspaceTabIds(input: IdleTabInput): string[] {
  const sessions = new Map(input.sessions.map((session) => [session.id, session]));
  return input.tabs
    .filter((tab) => tab.id !== input.activeTabId && tabIsIdle(tab, input, sessions))
    .map((tab) => tab.id);
}

/**
 * A chat nobody has typed in or saved: no user or assistant turn, no draft,
 * no provider conversation, and no pending or seeded composer content.
 */
export function isEmptyNewChat(session: Session): boolean {
  // Lazy transcripts report paging through this flag; an unloaded page may hide content.
  if (session.historyLoading || session.historyLoadError) return false;
  if (
    session.blocks.some(
      (block) => block.role === "user" || block.role === "assistant" || block.draft,
    )
  )
    return false;
  if ((session.rewindHistory?.length ?? 0) > 0) return false;
  if (
    session.providerSessionId ||
    session.pendingSwitch ||
    session.pendingContextReplay ||
    session.adoptedSyncConflict ||
    session.composerSeed ||
    session.inboxAsk ||
    session.inboxCard ||
    session.noteCard ||
    session.handoffCard ||
    session.linkedWorkItem ||
    session.linkedWorkItemUpdateCard ||
    session.automationId ||
    session.orchestrationLeadId ||
    session.worktreePreparing ||
    session.worktreeRemoved
  )
    return false;
  return true;
}

/**
 * Keeps the candidate tabs none of whose sessions appear in the project's saved
 * conversation list. A saved conversation always appears there, so a session
 * missing from it is confirmed never to have been used.
 */
export function unlistedTabIds(
  candidateIds: readonly string[],
  tabs: readonly WorkspaceTab[],
  listedSessionIds: ReadonlySet<string>,
): string[] {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  return candidateIds.filter((id) => {
    const tab = byId.get(id);
    return (
      tab !== undefined && leafIds(tab.layout).every((session) => !listedSessionIds.has(session))
    );
  });
}

/**
 * Tab ids of other projects whose every session is an empty new chat with
 * nothing unsent, plus no editor or terminal panes. The active, moving and
 * current-project tabs are never returned, and tabs without a project (or
 * with a remote one) are left alone.
 */
export function emptyForeignTabIds(input: IdleTabInput, currentProject: string): string[] {
  const sessions = new Map(input.sessions.map((session) => [session.id, session]));
  return input.tabs
    .filter((tab) => {
      if (tab.id === input.activeTabId || input.movingTabIds?.has(tab.id)) return false;
      const project = workspaceTabCwd(tab, input.sessions);
      if (!project || isRemoteProjectPath(project) || sameProjectPath(project, currentProject))
        return false;
      if (tab.editorPanes.length > 0 || (tab.terminalPanes ?? []).length > 0) return false;
      return (
        tabIsIdle(tab, input, sessions) &&
        leafIds(tab.layout).every((id) => {
          const session = sessions.get(id);
          return session !== undefined && isEmptyNewChat(session);
        })
      );
    })
    .map((tab) => tab.id);
}
