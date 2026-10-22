import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import type { InboxSessionPortal } from "../../../features/inbox/ui/InboxDiscussionPanel";
import { inboxAskKey } from "../../../features/inbox/model/inboxAsk";
import { type InboxItem } from "../../../features/inbox/model/githubTasks";
import { inboxTrackerDescription } from "../../../features/inbox/model/inboxContext";
import { gitlabWorkItemDetails, peekGitlabWorkItemDetails } from "../../../features/inbox/model/gitlab";
import {
  azureDevOpsWorkItemDetails,
  peekAzureDevOpsWorkItemDetails,
} from "../../../features/inbox/model/azureDevOps";
import { newDefaultSession, newSession, type Session } from "../../../features/sessions/model/session";
import { deleteSession, type SessionSummary } from "../../../features/sessions/data/sessionStore";
import { setSessions } from "../../../features/sessions/model/sessionsStore";
import { sessionChildHarnesses } from "../../../features/sessions/model/handoff";
import { forgetHarnessSession } from "../../../integrations/harness";
import { routeWindowDestination } from "../../model/windowNavigation";
import type { ToolWindow } from "../../model/toolWindows";
import type { SidebarTabId } from "../../../features/settings/model/appearance";

export interface InboxAskPortalState {
  inboxAskPortal: InboxSessionPortal | null;
  setInboxAskPortal: Dispatch<SetStateAction<InboxSessionPortal | null>>;
  openingInboxSessions: MutableRefObject<Map<string, Promise<string>>>;
}

/** Portal state for the inbox ask surface plus the in-flight ask registry. */
export function useInboxAskPortal(): InboxAskPortalState {
  const [inboxAskPortal, setInboxAskPortal] = useState<InboxSessionPortal | null>(null);
  const openingInboxSessions = useRef(new Map<string, Promise<string>>());
  return { inboxAskPortal, setInboxAskPortal, openingInboxSessions };
}

export interface InboxAskOpenDeps {
  openingInboxSessions: MutableRefObject<Map<string, Promise<string>>>;
  sessionsRef: MutableRefObject<Session[]>;
  sidebarCwd: string;
}

/** Opens (or reuses) the hidden ask session for an inbox item. */
export function useInboxAskOpen(deps: InboxAskOpenDeps) {
  const { openingInboxSessions, sessionsRef, sidebarCwd } = deps;
  return useCallback(
    (item: InboxItem): Promise<string> => {
      const key = inboxAskKey(item);
      const pending = openingInboxSessions.current.get(key);
      if (pending) return pending;
      const opening = (async () => {
        let session = sessionsRef.current.find((entry) => entry.inboxAsk?.key === key);
        if (!session) {
          const candidate = item.projectPath || sidebarCwd;
          const cwd =
            candidate && candidate !== "~" ? candidate : await invoke<string>("default_cwd");
          const description =
            item.provider === "linear" || item.provider === "jira"
              ? await inboxTrackerDescription(item)
              : item.provider === "gitlab" && (item.kind === "issue" || item.kind === "pr")
                ? (
                    peekGitlabWorkItemDetails(item.repo, item.kind, item.number) ??
                    (await gitlabWorkItemDetails(item.repo, item.kind, item.number))
                  ).body
                : item.provider === "azuredevops" && (item.kind === "issue" || item.kind === "pr")
                  ? (
                      peekAzureDevOpsWorkItemDetails(item.repo, item.kind, item.number) ??
                      (await azureDevOpsWorkItemDetails(item.repo, item.kind, item.number))
                    ).body
                  : undefined;
          session = {
            ...newDefaultSession(cwd),
            get title() {
              return t("Ask · {p0}", { p0: item.title });
            },
            inboxAsk: {
              key,
              title: item.title,
              url: item.url,
              provider: item.provider,
              description,
            },
          };
          sessionsRef.current = [...sessionsRef.current, session];
          setSessions(sessionsRef.current);
        }
        return session.id;
      })();
      openingInboxSessions.current.set(key, opening);
      void opening.then(
        () => openingInboxSessions.current.delete(key),
        () => openingInboxSessions.current.delete(key),
      );
      return opening;
    },
    [sidebarCwd],
  );
}

export interface InboxAskRestartDeps {
  onAskInboxItem: (item: InboxItem) => Promise<string>;
  stopSessionForRemoval: (sessionId: string) => Promise<Session | undefined>;
  removingSessionIds: MutableRefObject<Set<string>>;
  sessionsRef: MutableRefObject<Session[]>;
  setInboxAskPortal: Dispatch<SetStateAction<InboxSessionPortal | null>>;
  inboxAskPortal: InboxSessionPortal | null;
  inboxViewOpen: boolean;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

/** Recreates a stopped inbox ask session and keeps the ask portal pointing at it. */
export function useInboxAskRestart(deps: InboxAskRestartDeps) {
  const {
    onAskInboxItem,
    stopSessionForRemoval,
    removingSessionIds,
    sessionsRef,
    setInboxAskPortal,
    inboxAskPortal,
    inboxViewOpen,
    setComposerFocused,
  } = deps;
  const onRestartInboxAsk = useCallback(
    async (item: InboxItem): Promise<string> => {
      const id = await onAskInboxItem(item);
      const current = sessionsRef.current.find((session) => session.id === id)!;
      removingSessionIds.current.add(id);
      try {
        await stopSessionForRemoval(id);
        const stopped = sessionsRef.current.find((session) => session.id === id) ?? current;
        await Promise.all(
          sessionChildHarnesses(stopped).map((harness) => forgetHarnessSession(harness, id)),
        );
        const imagePaths = stopped.blocks.flatMap((block) =>
          block.role === "image" && block.image ? [block.image.path] : [],
        );
        await deleteSession(id, imagePaths);
        const fresh = {
          ...newSession(
            stopped.harness,
            stopped.cwd,
            stopped.model,
            stopped.runtimeMode,
            stopped.modelSettings,
          ),
          title: stopped.title,
          inboxAsk: stopped.inboxAsk,
        };
        const next = sessionsRef.current.map((session) => (session.id === id ? fresh : session));
        sessionsRef.current = next;
        setSessions(next);
        setInboxAskPortal((portal) =>
          portal?.sessionId === id ? { ...portal, sessionId: fresh.id } : portal,
        );
        return fresh.id;
      } finally {
        removingSessionIds.current.delete(id);
      }
    },
    [onAskInboxItem, stopSessionForRemoval],
  );

  useEffect(() => {
    if (!inboxAskPortal || !inboxViewOpen) return;
    setComposerFocused(true);
  }, [inboxAskPortal, inboxViewOpen]);

  return { onRestartInboxAsk };
}

export interface OpenInboxSessionDeps {
  sessionsRef: MutableRefObject<Session[]>;
  history: SessionSummary[];
  toolWindow: ToolWindow | null | undefined;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
}

/** Opens an inbox session in the sessions list, routing to another window when needed. */
export function useOpenInboxSession(deps: OpenInboxSessionDeps) {
  const {
    sessionsRef,
    history,
    toolWindow,
    setInboxViewOpen,
    setSidebarTab,
    onSelectHistorySession,
  } = deps;
  return useCallback(
    async (sessionId: string, routed = false) => {
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd;
      if (routed !== true && await routeWindowDestination({ kind: "session", sessionId, cwd }, !!toolWindow)) return;
      setInboxViewOpen(false);
      setSidebarTab("sessions", cwd);
      await onSelectHistorySession(sessionId);
    },
    [history, onSelectHistorySession, toolWindow],
  );
}
