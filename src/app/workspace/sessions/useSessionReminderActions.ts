import { useCallback, type Dispatch, type SetStateAction } from "react";
import { type Session } from "../../../features/sessions/model/session";
import { upsertSession } from "../../../features/sessions/data/sessionStore";
import { rememberProject, type RecentProject } from "../../../features/projects/model/recents";
import { useSessionReminders } from "../../../features/notifications/hooks/useSessionReminders";
import { type SidebarTabId } from "../../../features/settings/model/appearance";

export interface SessionReminderActionsDeps {
  sessions: Session[];
  sessionsRef: { current: Session[] };
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  onSelectHistorySession: (sessionId: string) => Promise<void>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setFilePickerOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
}

/** Opens the conversation behind a due reminder and persists unsaved reminder sessions. */
export function useSessionReminderActions({
  sessions,
  sessionsRef,
  ensureOpenSession,
  onSelectHistorySession,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  setSettingsOpen,
  setFilePickerOpen,
  setSidebarTab,
  setProjectCwd,
  setRecents,
}: SessionReminderActionsDeps) {
  const openReminderSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session) throw new Error("This conversation is no longer available.");
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession],
  );

  const ensureReminderSessionsSaved = useCallback(async (ids: readonly string[]) => {
    for (const id of ids) {
      const session = sessionsRef.current.find((session) => session.id === id);
      if (session && !(await upsertSession(session))) {
        throw new Error("Send a message in this conversation before setting a reminder.");
      }
    }
  }, []);

  const sessionReminders = useSessionReminders(
    openReminderSession,
    ensureReminderSessionsSaved,
    sessions.filter((session) => !session.inboxAsk).map((session) => session.id),
  );

  return { sessionReminders };
}
