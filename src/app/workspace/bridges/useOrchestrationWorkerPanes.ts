import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo } from "react";
import type { WorkerDetailRequest } from "./useOrchestrationState";
import { type WorkspaceTab, leafIds, newAgentTab, openEditorTab } from "../../../features/workspace/model/layout";
import { prepareOrchestrationWorkerDetails } from "../../../features/orchestration/model/orchestrationWorkspace";
import { type OrchestrationWorkerDetail } from "../../../features/orchestration/ui/OrchestrationActions";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";

export interface OrchestrationWorkerPanesDeps {
  tabs: WorkspaceTab[];
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  projectCwdRef: MutableRefObject<string>;
  focusOpenSession: (sessionId: string) => boolean;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
  ensureOpenSession: Parameters<typeof prepareOrchestrationWorkerDetails>[1]["openWorker"];
  inspectedWorkerId: string | null;
  setInspectedWorkerId: Dispatch<SetStateAction<string | null>>;
  workerDetailRequest: WorkerDetailRequest | null;
  setWorkerDetailRequest: Dispatch<SetStateAction<WorkerDetailRequest | null>>;
}

export function useOrchestrationWorkerPanes({
  tabs,
  setTabs,
  setActiveTabId,
  setComposerFocused,
  projectCwdRef,
  focusOpenSession,
  onSelectHistorySession,
  ensureOpenSession,
  inspectedWorkerId,
  setInspectedWorkerId,
  workerDetailRequest,
  setWorkerDetailRequest,
}: OrchestrationWorkerPanesDeps) {
  const queueWorkerPanes = useCallback(
    (workers: OrchestrationWorkerDetail[]) => {
      // Finished workers are not open; load stored transcripts before the
      // tabs appear so the pane does not flash the empty state.
      void prepareOrchestrationWorkerDetails(workers, {
        openLead: async (leadId) => {
          if (!focusOpenSession(leadId)) await onSelectHistorySession(leadId);
        },
        openWorker: ensureOpenSession,
        hasSession: (id) => sessionsRef.current.some((session) => session.id === id),
      })
        .then((request) => {
          if (request?.workers.length) setWorkerDetailRequest(request);
        })
        .catch(console.error);
    },
    [ensureOpenSession, focusOpenSession, onSelectHistorySession],
  );
  const onOpenWorkerDetails = useCallback(
    (worker: OrchestrationWorkerDetail) => {
      setInspectedWorkerId(worker.sessionId);
      queueWorkerPanes([worker]);
    },
    [queueWorkerPanes],
  );
  useEffect(() => {
    if (!workerDetailRequest) return;
    const { leadId, workers } = workerDetailRequest;
    const tab = tabs.find((entry) => leafIds(entry.layout).includes(leadId));
    if (!tab) {
      // Still opening: this runs again on the commit that lands the lead. If
      // the lead never arrived at all, drop the request rather than let it
      // fire against some later tab change.
      if (!sessionsRef.current.some((entry) => entry.id === leadId)) {
        setWorkerDetailRequest(null);
      }
      return;
    }
    setWorkerDetailRequest(null);
    // Every agent of a run shares one pane, the way files do: `openEditorTab`
    // focuses an open tab, adds to the pane already beside the lead, or splits
    // one off when there is none.
    const cwd =
      sessionsRef.current.find((entry) => entry.id === leadId)?.cwd ?? projectCwdRef.current;
    const files = workers.map((worker) =>
      newAgentTab(worker.title, cwd, {
        sessionId: worker.sessionId,
        leadId,
        harness: worker.harness,
      }),
    );
    setTabs((prev) =>
      prev.map((entry) => {
        if (entry.id !== tab.id) return entry;
        const opened = files.reduce((next, file) => openEditorTab(next, file), entry);
        // Leave the first worker focused so View agents lands on the start
        // of the run rather than the last tab added.
        return files[0] ? openEditorTab(opened, files[0]) : opened;
      }),
    );
    setActiveTabId(tab.id);
    setComposerFocused(false);
  }, [tabs, workerDetailRequest]);
  const orchestrationWorkers = useMemo(
    () => ({
      selectedId: inspectedWorkerId,
      inspect: setInspectedWorkerId,
      openDetails: onOpenWorkerDetails,
    }),
    [inspectedWorkerId, onOpenWorkerDetails],
  );
  return { queueWorkerPanes, orchestrationWorkers };
}
