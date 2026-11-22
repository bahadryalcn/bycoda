import { workspaceFailureDetail } from "../../model/workspaceActionError";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { archiveFocusedSession } from "../../../features/sessions/model/archiveShortcut";
import { type Session } from "../../../features/sessions/model/session";
import {
  setSessionArchived,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
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
  serversViewOpenRef?: MutableRefObject<boolean>;
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
    serversViewOpenRef,
    settingsOpenRef,
    filePickerOpenRef,
    whatsNewVersionRef,
  } = deps;

  const onArchiveHistorySession = useCallback(
    async (sessionId: string, archived: boolean, listed?: SessionSummary) => {
      if (archived) return onRemoveHistorySession(sessionId, "archive", false, undefined, listed);
      if (removingSessionIds.current.has(sessionId)) return false;
      removingSessionIds.current.add(sessionId);
      try {
        await setSessionArchived(sessionId, false);
        setHistory((current) =>
          current.map((entry) => (entry.id === sessionId ? { ...entry, archived: false } : entry)),
        );
        return true;
      } catch (error) {
        toast.show({
          tone: "danger",
          title: t("Could not unarchive this conversation."),
          message: workspaceFailureDetail(error),
        });
        return false;
      } finally {
        removingSessionIds.current.delete(sessionId);
      }
    },
    [onRemoveHistorySession, setHistory, removingSessionIds],
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
            serversViewOpenRef?.current ||
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
    [
      onArchiveHistorySession,
      tabsRef,
      whatsNewVersionRef,
      sessionsRef,
      inboxViewOpenRef,
      notesViewOpenRef,
      filePickerOpenRef,
      projectTerminalFocusedRef,
      searchViewOpenRef,
      automationsViewOpenRef,
      serversViewOpenRef,
      activeTabIdRef,
      settingsOpenRef,
    ],
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
