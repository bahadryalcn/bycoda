import { useLayoutEffect, useState, type MutableRefObject } from "react";
import { HarnessEventQueue } from "../../model/harnessFlush";
import { TranscriptPool } from "../../../features/sessions/ui/TranscriptPool";
import { applyHarnessEvents } from "../../../integrations/harness";
import { syncDockBadge } from "../../../features/notifications/model/dockBadge";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  isTextOnlyChange,
  sessionsRef,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";

export interface HarnessEventQueueDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  foregroundSurfaceRef: MutableRefObject<{
    workspaceVisible: boolean;
    inboxSessionId?: string;
  }>;
}

export interface HarnessEventQueueState {
  transcriptPool: TranscriptPool;
  harnessQueue: HarnessEventQueue;
  flushHarnessEvents: () => void;
  enqueueHarnessEvent: HarnessEventQueue["enqueue"];
}

// Harness token queue and the shared transcript pool. Single instance per
// Workspace; the refs it reads are owned by Workspace.
export function useHarnessEventQueue({
  tabsRef,
  activeTabIdRef,
  foregroundSurfaceRef,
}: HarnessEventQueueDeps): HarnessEventQueueState {
  const [transcriptPool] = useState(() => new TranscriptPool());
  // Tokens arrive many times per frame; apply them once so React/markdown aren't
  // recomputed for every delta.
  const [harnessQueue] = useState(
    () =>
      new HarnessEventQueue(
        (sessionId) => {
          const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
          return (
            foregroundSurfaceRef.current.inboxSessionId === sessionId ||
            (foregroundSurfaceRef.current.workspaceVisible &&
              !!tab &&
              (leafIds(tab.layout).includes(sessionId) ||
                tab.editorPanes.some((pane) =>
                  pane.files.some(
                    (file) => file.id === pane.activeFileId && file.agent?.sessionId === sessionId,
                  ),
                )))
          );
        },
        (batches) => {
          const prev = sessionsRef.current;
          const next = prev.map((session) => {
            const events = batches.get(session.id);
            return events ? applyHarnessEvents(session, events) : session;
          });
          if (!next.some((session, index) => session !== prev[index])) return;
          sessionsRef.current = next;
          if (!isTextOnlyChange(prev, next)) syncDockBadge(next);
          setSessions(next);
        },
      ),
  );
  const flushHarnessEvents = harnessQueue.flush;
  const enqueueHarnessEvent = harnessQueue.enqueue;

  return { transcriptPool, harnessQueue, flushHarnessEvents, enqueueHarnessEvent };
}

export interface HarnessBeforePaintFlushDeps {
  flushHarnessEvents: () => void;
  activeTabId: string;
  inboxViewOpen: boolean;
  inboxAskSessionId: string | undefined;
  searchViewOpen: boolean;
  notesViewOpen: boolean;
  automationsViewOpen: boolean;
  settingsOpen: boolean;
}

export function useHarnessBeforePaintFlush({
  flushHarnessEvents,
  activeTabId,
  inboxViewOpen,
  inboxAskSessionId,
  searchViewOpen,
  notesViewOpen,
  automationsViewOpen,
  settingsOpen,
}: HarnessBeforePaintFlushDeps): void {
  useLayoutEffect(() => {
    // A newly selected chat catches up before paint, even if its output was
    // waiting on the background cadence. Draft/composer input stays immediate.
    flushHarnessEvents();
  }, [
    activeTabId,
    inboxViewOpen,
    inboxAskSessionId,
    searchViewOpen,
    notesViewOpen,
    automationsViewOpen,
    settingsOpen,
    flushHarnessEvents,
  ]);
}
