import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import { branchSessionFromReply } from "../../../features/sessions/model/conversationBranch";
import type { Block, Session } from "../../../features/sessions/model/session";
import { type setSessions } from "../../../features/sessions/model/sessionsStore";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";

export interface BranchSessionDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: typeof setSessions;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  persistSession: (session: Session | undefined) => void;
  ensureSessionHistoryForExecution: (sessionId: string) => Promise<boolean>;
  /** Shows a session that is already open or stored, without changing it. */
  openSession: (sessionId: string) => void;
}

/**
 * Branch from here: a new session in the same project and machine whose transcript is the source's through one reply.
 * The source session is never written; the branch opens as a new tab and replays the kept transcript on its first turn.
 */
export function useBranchSession({
  sessionsRef,
  setSessions,
  setActiveTabId,
  setProjectTerminalFocused,
  setComposerFocused,
  appendTab,
  persistSession,
  ensureSessionHistoryForExecution,
  openSession,
}: BranchSessionDeps) {
  const onBranchFromReply = useCallback(
    async (sourceId: string, turn: Block[]) => {
      const find = () => sessionsRef.current.find((session) => session.id === sourceId);
      const failed = (message: string) => toast.show({ tone: "warning", message });
      let source = find();
      if (!source) return;
      if (source.storedHistory) {
        // Only a tail page is loaded; a branch needs the whole kept transcript.
        const ready = await ensureSessionHistoryForExecution(sourceId).catch(() => false);
        if (!ready) return failed(t("Earlier messages could not be loaded."));
        source = find();
        if (!source) return;
      }
      const branch = branchSessionFromReply(source, turn);
      if (!branch) return failed(t("This reply cannot be branched."));
      const next = [...sessionsRef.current, branch];
      sessionsRef.current = next;
      setSessions(next);
      const tab = newTab(branch.id);
      appendTab(tab, source.cwd);
      setActiveTabId(tab.id);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
      persistSession(branch);
    },
    [
      appendTab,
      ensureSessionHistoryForExecution,
      persistSession,
      sessionsRef,
      setActiveTabId,
      setComposerFocused,
      setProjectTerminalFocused,
      setSessions,
    ],
  );
  const onOpenBranchSource = useCallback(
    (sourceId: string) => openSession(sourceId),
    [openSession],
  );
  return { onBranchFromReply, onOpenBranchSource };
}
