import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { t } from "../../../shared/i18n";
import type { Session } from "../../../features/sessions/model/session";
import { newDefaultSession } from "../../../features/sessions/model/session";
import { linkedWorkItemFromInboxItem } from "../../../features/sessions/model/sessionWorkItem";
import { isPreparingHandoff } from "../../../features/sessions/model/handoff";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { type InboxItem } from "../../../features/inbox/model/githubTasks";
import type { CiRepairRequest } from "../../../features/inbox/model/ciRepair";
import { trackCiRepair } from "../../../features/inbox/model/ciRepairTracking";
import { type SidebarTabId } from "../../../features/settings/model/appearance";
import type { useSubmitSession } from "../sessions/submit/useSubmitSession";

export interface RepairChecksDeps {
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  onSubmit: ReturnType<typeof useSubmitSession>["onSubmit"];
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
  sessionDefaults: Session | undefined;
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
}

/** Starts a CI repair run for an inbox PR, in a new or chosen project chat. */
export function useRepairChecks(deps: RepairChecksDeps): {
  onRepairChecks: (item: InboxItem, request: CiRepairRequest, sessionId?: string) => Promise<void>;
} {
  const {
    ensureOpenSession,
    onSubmit,
    onSelectHistorySession,
    sessionDefaults,
    sessionsRef,
    setSessions,
    setInboxViewOpen,
    setNotesViewOpen,
    setSearchViewOpen,
    setSidebarTab,
  } = deps;

  const onRepairChecks = useCallback(
    async (item: InboxItem, request: CiRepairRequest, sessionId?: string) => {
      const cwd = item.projectPath;
      if (!cwd) throw new Error("Choose a local project for this PR first.");
      let session = sessionId ? await ensureOpenSession(sessionId) : undefined;
      if (
        sessionId &&
        (!session ||
          session.inboxAsk ||
          session.orchestrationLeadId ||
          !sameProjectPath(session.cwd, cwd))
      ) {
        throw new Error("Choose a chat from this project.");
      }
      if (session && (session.busy || session.pendingSwitch || isPreparingHandoff(session))) {
        throw new Error("This chat is busy. Choose another chat or start a new one.");
      }
      if (!session) {
        session = {
          ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
          get title() {
            return t("Fix CI #{p0}: {p1}", { p0: item.number, p1: item.title });
          },
          linkedWorkItem: linkedWorkItemFromInboxItem(item) ?? undefined,
        };
        const next = [...sessionsRef.current, session];
        sessionsRef.current = next;
        setSessions(next);
      }
      const repairSessionId = session.id;
      trackCiRepair(cwd, request, repairSessionId, (settle) =>
        onSubmit(repairSessionId, request.text, [], {
          ciRepair: request,
          noteCard: undefined,
          handoffCard: undefined,
          onSettled: (outcome) => settle(outcome.status),
        }),
      );
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSearchViewOpen(false);
      setSidebarTab("sessions", cwd);
      await onSelectHistorySession(session.id);
    },
    [ensureOpenSession, onSubmit, onSelectHistorySession, sessionDefaults?.runtimeMode],
  );

  return { onRepairChecks };
}
