import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { LinkedWorkItem, Session } from "../../../features/sessions/model/session";
import type { SessionSummary } from "../../../features/sessions/data/sessionStore";
import {
  completeLinkedWorkItemUpdateCard,
  failLinkedWorkItemUpdateCard,
  pendingLinkedWorkItemUpdateCard,
  type LinkedWorkItemUpdateCard,
} from "../../../features/inbox/model/linkedWorkItemActivity";
import { githubWorkItemThread } from "../../../features/inbox/model/githubTasks";
import type { LinkedSessionUpdate } from "../../../features/inbox/model/linkedSessionUpdates";
import type { LinkedWorkItemPanelState } from "../helpers/types";

export interface LinkedWorkItemPanelStateResult {
  linkedWorkItemPanels: ReadonlyMap<string, LinkedWorkItemPanelState>;
  setLinkedWorkItemPanels: Dispatch<SetStateAction<ReadonlyMap<string, LinkedWorkItemPanelState>>>;
  linkedWorkItemPanelRequest: MutableRefObject<number>;
  closeLinkedWorkItemPanel: (sessionId: string) => void;
}

/** Linked work-item panel state, keyed by session id. */
export function useLinkedWorkItemPanelState(): LinkedWorkItemPanelStateResult {
  const [linkedWorkItemPanels, setLinkedWorkItemPanels] = useState<
    ReadonlyMap<string, LinkedWorkItemPanelState>
  >(() => new Map());
  const linkedWorkItemPanelRequest = useRef(0);
  const closeLinkedWorkItemPanel = useCallback((sessionId: string) => {
    linkedWorkItemPanelRequest.current += 1;
    setLinkedWorkItemPanels((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }, []);
  return {
    linkedWorkItemPanels,
    setLinkedWorkItemPanels,
    linkedWorkItemPanelRequest,
    closeLinkedWorkItemPanel,
  };
}

export interface RevealLinkedSessionUpdateDeps {
  sessionsRef: MutableRefObject<Session[]>;
  linkedSessionUpdatesRef: MutableRefObject<ReadonlyMap<string, LinkedSessionUpdate>>;
  linkedWorkItemActivityFetches: MutableRefObject<Map<string, number>>;
  setLinkedWorkItemUpdateCard: (
    sessionId: string,
    update: (card: LinkedWorkItemUpdateCard | undefined) => LinkedWorkItemUpdateCard | undefined,
  ) => void;
}

/** Refreshes the linked work-item card of an open session when its update changes. */
export function useRevealLinkedSessionUpdate(deps: RevealLinkedSessionUpdateDeps) {
  const {
    sessionsRef,
    linkedSessionUpdatesRef,
    linkedWorkItemActivityFetches,
    setLinkedWorkItemUpdateCard,
  } = deps;
  return useCallback(
    (sessionId: string, update: LinkedSessionUpdate) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session?.linkedWorkItem) return;
      if (
        session.linkedWorkItemUpdateCard?.updatedAt === update.updatedAt &&
        session.linkedWorkItemUpdateCard.status !== "error"
      ) {
        return;
      }
      if (linkedWorkItemActivityFetches.current.get(sessionId) === update.updatedAt) {
        return;
      }
      const pending = pendingLinkedWorkItemUpdateCard(update);
      linkedWorkItemActivityFetches.current.set(sessionId, update.updatedAt);
      // A stale/error card should not remain visible while fresh details load.
      // The session itself is already open; this request stays fully detached
      // from the navigation path.
      setLinkedWorkItemUpdateCard(sessionId, (current) =>
        current?.updatedAt === update.updatedAt && current.status === "ready" ? current : undefined,
      );

      void githubWorkItemThread(
        session.cwd,
        session.linkedWorkItem.repo,
        session.linkedWorkItem.kind,
        session.linkedWorkItem.number,
        { force: true },
      ).then(
        (thread) => {
          if (linkedWorkItemActivityFetches.current.get(sessionId) !== pending.updatedAt) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !== pending.updatedAt) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () =>
            completeLinkedWorkItemUpdateCard(pending, thread),
          );
        },
        () => {
          if (linkedWorkItemActivityFetches.current.get(sessionId) !== pending.updatedAt) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !== pending.updatedAt) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () => failLinkedWorkItemUpdateCard(pending));
        },
      );
    },
    [setLinkedWorkItemUpdateCard],
  );
}

export interface OpenLinkedWorkItemDeps {
  linkedWorkItemPanelRequest: MutableRefObject<number>;
  setFilePickerOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setLinkedWorkItemPanels: Dispatch<SetStateAction<ReadonlyMap<string, LinkedWorkItemPanelState>>>;
  sessionsRef: MutableRefObject<Session[]>;
  history: SessionSummary[];
  sidebarCwd: string;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
}

/** Opens a session from an inbox work item and pins its linked work-item panel. */
export function useOpenLinkedWorkItem(deps: OpenLinkedWorkItemDeps) {
  const {
    linkedWorkItemPanelRequest,
    setFilePickerOpen,
    setSettingsOpen,
    setSearchViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setServersViewOpen,
    setInboxViewOpen,
    setLinkedWorkItemPanels,
    sessionsRef,
    history,
    sidebarCwd,
    onSelectHistorySession,
  } = deps;
  return useCallback(
    (item: LinkedWorkItem, sessionId: string) => {
      const request = linkedWorkItemPanelRequest.current + 1;
      linkedWorkItemPanelRequest.current = request;
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      setInboxViewOpen(false);
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd ??
        sidebarCwd;
      void onSelectHistorySession(sessionId).then(() => {
        if (linkedWorkItemPanelRequest.current !== request) return;
        if (!sessionsRef.current.some((session) => session.id === sessionId)) {
          return;
        }
        setLinkedWorkItemPanels((current) => {
          const next = new Map(current);
          // Reinsert the panel so it wins if this workspace tab contains
          // multiple sessions with remembered panels.
          next.delete(sessionId);
          next.set(sessionId, { item, sessionId, cwd });
          return next;
        });
      });
    },
    [history, onSelectHistorySession, sidebarCwd],
  );
}
