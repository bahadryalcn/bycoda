import { startTransition, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { applyAddToChatRequest } from "../../../features/sessions/model/addChatToWorkspace";
import { ADD_TO_CHAT_EVENT, type AddToChatRequest } from "../../../features/sessions/model/quoteDraft";
import type { Session } from "../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import { ADD_NOTE_TO_CHAT_EVENT, type NoteComposerCard } from "../../../features/notes";
import { OPEN_WORKTREE_MANAGEMENT, type WorktreeManagementRequest } from "../../../features/source-control/model/worktreeManagement";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";

export interface AddToChatListenerDeps {
  sessionDefaults: Session | undefined;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<Parameters<typeof applyAddToChatRequest>[0]["activeTabId"]>;
  projectCwdRef: MutableRefObject<string>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: (focused: boolean) => void;
  setComposerFocused: (focused: boolean) => void;
}

/** Window `ADD_TO_CHAT_EVENT` listener: places quoted text into the chat composer. */
export function useAddToChatListener({
  sessionDefaults,
  tabsRef,
  activeTabIdRef,
  projectCwdRef,
  setTabs,
  setActiveTabId,
  setProjectTerminalFocused,
  setComposerFocused,
}: AddToChatListenerDeps): void {
  useEffect(() => {
    const openSessionForAddToChat = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (!detail?.text) return;

      const result = applyAddToChatRequest({
        sessions: sessionsRef.current,
        tabs: tabsRef.current,
        activeTabId: activeTabIdRef.current,
        projectCwd: projectCwdRef.current,
        fallbackCwd: sessionDefaults?.cwd,
        defaultRuntimeMode: sessionDefaults?.runtimeMode,
        text: detail.text,
        mode: detail.mode,
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    };

    window.addEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
  }, [sessionDefaults?.cwd, sessionDefaults?.runtimeMode]);
}

/** Window `ADD_NOTE_TO_CHAT_EVENT` listener: forwards note cards to the new-session action. */
export function useAddNoteToChatListener(onAddNoteToChat: (card: NoteComposerCard) => void): void {
  useEffect(() => {
    const onAdd = (event: Event) => {
      const card = (event as CustomEvent<NoteComposerCard>).detail;
      if (!card?.id) return;
      onAddNoteToChat(card);
    };
    window.addEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
  }, [onAddNoteToChat]);
}

export interface WorktreeManagementListenerDeps {
  setWorktreeManagementRequest: Dispatch<SetStateAction<WorktreeManagementRequest | null>>;
  setWorktreeManagementRevision: Dispatch<SetStateAction<number>>;
}

/** Window `OPEN_WORKTREE_MANAGEMENT` listener: opens the worktree management request. */
export function useWorktreeManagementListener({
  setWorktreeManagementRequest,
  setWorktreeManagementRevision,
}: WorktreeManagementListenerDeps): void {
  useEffect(() => {
    const manage = (event: Event) => {
      const request = (event as CustomEvent<WorktreeManagementRequest>).detail;
      if (!request?.cwd || request.cwd === "~") return;
      startTransition(() => {
        setWorktreeManagementRequest(request);
        setWorktreeManagementRevision((revision) => revision + 1);
      });
    };
    window.addEventListener(OPEN_WORKTREE_MANAGEMENT, manage);
    return () => window.removeEventListener(OPEN_WORKTREE_MANAGEMENT, manage);
  }, []);
}
