import { message } from "@tauri-apps/plugin-dialog";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { archiveFocusedSession } from "../../../features/sessions/model/archiveShortcut";
import { type Session } from "../../../features/sessions/model/session";
import {
  setSessionArchived,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import { appName } from "../../../shared/lib/appName";
import type { useHistorySessionDelete } from "./useHistorySessionDelete";

export interface HistorySessionArchiveDeps {
  onRemoveHistorySession: ReturnType<typeof useHistorySessionDelete>["onRemoveHistorySession"];
  removingSessionIds: MutableRefObject<Set<string>>;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  sessionsRef: MutableRefObject<Session[]>;
  activeTabIdRef: MutableRefObject<string>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  projectTerminalFocusedRef: MutableRefObject<boolean>;
  searchViewOpenRef: MutableRefObject<boolean>;
  inboxViewOpenRef: MutableRefObject<boolean>;
  notesViewOpenRef: MutableRefObject<boolean>;
  automationsViewOpenRef: MutableRefObject<boolean>;
  settingsOpenRef: MutableRefObject<boolean>;
  filePickerOpenRef: MutableRefObject<boolean>;
  whatsNewVersionRef: MutableRefObject<string | null>;
}

export function useHistorySessionArchive(deps: HistorySessionArchiveDeps) {
  const {
    onRemoveHistorySession,
    removingSessionIds,
    setHistory,
    sessionsRef,
    activeTabIdRef,
    tabsRef,
    projectTerminalFocusedRef,
    searchViewOpenRef,
    inboxViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
    settingsOpenRef,
    filePickerOpenRef,
    whatsNewVersionRef,
  } = deps;

  const onArchiveHistorySession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (archived) return onRemoveHistorySession(sessionId, "archive");
      if (removingSessionIds.current.has(sessionId)) return false;
      try {
        await setSessionArchived(sessionId, false);
        setHistory((current) =>
          current.map((entry) => (entry.id === sessionId ? { ...entry, archived: false } : entry)),
        );
        return true;
      } catch (error) {
        void message(`Could not unarchive this conversation.\n\n${String(error)}`, {
          title: appName(),
          kind: "error",
        });
        return false;
      }
    },
    [onRemoveHistorySession],
  );

  const onArchiveFocusedSession = useCallback(
    (event: KeyboardEvent) => {
      archiveFocusedSession(
        event,
        {
          activeTabId: activeTabIdRef.current,
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          projectTerminalFocused: projectTerminalFocusedRef.current,
          surfaceOpen: Boolean(
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            automationsViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            whatsNewVersionRef.current,
          ),
        },
        (sessionId) => {
          void onArchiveHistorySession(sessionId, true);
        },
      );
    },
    [onArchiveHistorySession],
  );

  const onArchiveHistorySessions = useCallback(
    async (sessionIds: readonly string[], archived: boolean) => {
      for (const sessionId of sessionIds) {
        if (!(await onArchiveHistorySession(sessionId, archived))) break;
      }
    },
    [onArchiveHistorySession],
  );

  return { onArchiveHistorySession, onArchiveFocusedSession, onArchiveHistorySessions };
}
