import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { getSessions } from "../../../features/sessions/model/sessionsStore";
import { subscribeComposerDrafts } from "../../../features/sessions/model/draftCache";
import {
  hasSessionDraft,
  keepSessionTab,
  openSessionPreview,
  sessionNeedsKeptTab,
} from "../../../features/workspace/model/sessionPreview";
import type { orchestrator } from "../../../features/orchestration/model/orchestration";
import { type Session } from "../../../features/sessions/model/session";
import { type LinkedSessionUpdate } from "../../../features/inbox/model/linkedSessionUpdates";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  planOpenSessionsSideBySide,
  SIDE_BY_SIDE_LIMIT,
} from "../../../features/workspace/model/workspaceTabGroups";

export interface OpenSessionActionsDeps {
  sessions: Session[];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setInspectedWorkerId: Dispatch<SetStateAction<string | null>>;
  followProject: (cwd: string | null | undefined) => void;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  insertBesideActive: (prev: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) => WorkspaceTab[];
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  focusOpenSession: (sessionId: string) => boolean;
  replaceBlankPaneWithSession: (session: Session) => boolean;
  linkedSessionUpdatesRef: MutableRefObject<ReadonlyMap<string, LinkedSessionUpdate>>;
  revealLinkedSessionUpdate: (sessionId: string, update: LinkedSessionUpdate) => void;
  orchestrator: typeof orchestrator;
  workspaceNavigation: { cancel: () => void; captureRequest?: () => () => boolean };
}

/** Opens a history session in the workspace, or several side by side in one tab. */
export function useOpenSessionActions({
  sessions,
  tabsRef,
  setTabs,
  setActiveTabId,
  setProjectTerminalFocused,
  setComposerFocused,
  setInspectedWorkerId,
  followProject,
  appendTab,
  insertBesideActive,
  ensureOpenSession,
  focusOpenSession,
  replaceBlankPaneWithSession,
  linkedSessionUpdatesRef,
  revealLinkedSessionUpdate,
  orchestrator,
  workspaceNavigation,
}: OpenSessionActionsDeps) {
  const openRequest = useRef(0);
  useEffect(
    () => () => {
      openRequest.current++;
    },
    [],
  );
  const onKeepSession = useCallback(
    (sessionId: string) => {
      setTabs((tabs) => {
        if (!tabs.some((tab) => tab.previewSessionId === sessionId)) return tabs;
        return tabs.map((tab) => (tab.previewSessionId === sessionId ? keepSessionTab(tab) : tab));
      });
    },
    [setTabs],
  );
  useEffect(
    () =>
      subscribeComposerDrafts((id) => {
        if (hasSessionDraft(id)) onKeepSession(id);
      }),
    [onKeepSession],
  );
  useEffect(() => {
    for (const tab of tabsRef.current) {
      if (
        tab.previewSessionId &&
        sessionNeedsKeptTab(sessions.find((session) => session.id === tab.previewSessionId))
      )
        onKeepSession(tab.previewSessionId);
    }
  }, [sessions, onKeepSession, tabsRef]);

  const onSelectHistorySession = useCallback(
    async (sessionId: string, options?: { preview?: boolean }) => {
      const request = ++openRequest.current;
      workspaceNavigation.cancel();
      const isCurrent = workspaceNavigation.captureRequest?.() ?? (() => true);
      let session = await ensureOpenSession(sessionId);
      if (request !== openRequest.current || !isCurrent() || !session || session.inboxAsk) return;
      const parentId = session.orchestrationLeadId ?? orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        session = await ensureOpenSession(parentId);
        if (request !== openRequest.current || !isCurrent() || !session) return;
        setInspectedWorkerId(sessionId);
      }
      const linkedUpdate = linkedSessionUpdatesRef.current.get(session.id);
      if (focusOpenSession(session.id)) {
        if (!options?.preview) onKeepSession(session.id);
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      if (options?.preview) {
        const replacement = openSessionPreview(tabsRef.current, session, getSessions());
        if (replacement) {
          tabsRef.current = replacement.tabs;
          setTabs(replacement.tabs);
          setActiveTabId(replacement.tab.id);
          followProject(session.cwd);
          setComposerFocused(true);
          if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
          return;
        }
      }
      if (replaceBlankPaneWithSession(session)) {
        const id = session.id;
        if (options?.preview && !sessionNeedsKeptTab(session)) {
          setTabs((tabs) =>
            tabs.map((tab) =>
              tab.focusedId === id && tab.layout.type === "leaf"
                ? { ...tab, previewSessionId: id }
                : tab,
            ),
          );
        }
        followProject(session.cwd);
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      const tab = {
        ...newTab(session.id),
        ...(options?.preview && !sessionNeedsKeptTab(session)
          ? { previewSessionId: session.id }
          : {}),
      };
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      followProject(session.cwd);
      setComposerFocused(true);
      if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
    },
    [
      appendTab,
      ensureOpenSession,
      focusOpenSession,
      followProject,
      replaceBlankPaneWithSession,
      revealLinkedSessionUpdate,
      onKeepSession,
      tabsRef,
      setTabs,
      setActiveTabId,
      setComposerFocused,
      setInspectedWorkerId,
      workspaceNavigation.cancel,
      workspaceNavigation.captureRequest,
    ],
  );

  /** Open several history sessions together as a grid in one new tab. */
  const onOpenSessionsSideBySide = useCallback(
    async (sessionIds: string[]) => {
      const wanted = [...new Set(sessionIds)].slice(0, SIDE_BY_SIDE_LIMIT);
      if (wanted.length === 0) return;
      workspaceNavigation.cancel();
      const request = ++openRequest.current;
      const isCurrent = workspaceNavigation.captureRequest?.() ?? (() => true);
      const loaded = await Promise.all(wanted.map((id) => ensureOpenSession(id)));
      if (request !== openRequest.current || !isCurrent()) return;
      const opened = loaded.filter((session): session is Session => !!session && !session.inboxAsk);
      if (opened.length === 0) return;
      if (opened.length === 1) {
        await onSelectHistorySession(opened[0].id);
        return;
      }
      const plan = planOpenSessionsSideBySide({
        tabs: tabsRef.current,
        sessionIds: opened.map((session) => session.id),
      });
      if (!plan) return;
      const cwd = opened[0].cwd;
      const next = insertBesideActive(plan.tabs, plan.tab, cwd);
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(plan.tab.id);
      setProjectTerminalFocused(false);
      followProject(cwd);
      setComposerFocused(true);
    },
    [
      ensureOpenSession,
      followProject,
      insertBesideActive,
      onSelectHistorySession,
      tabsRef,
      setTabs,
      setActiveTabId,
      setProjectTerminalFocused,
      setComposerFocused,
      workspaceNavigation.cancel,
      workspaceNavigation.captureRequest,
    ],
  );

  const onPreviewHistorySession = useCallback(
    (id: string, options?: { keepOpen?: boolean }) =>
      onSelectHistorySession(id, { preview: !options?.keepOpen }),
    [onSelectHistorySession],
  );

  return {
    onSelectHistorySession,
    onPreviewHistorySession,
    onKeepSession,
    onOpenSessionsSideBySide,
  };
}
