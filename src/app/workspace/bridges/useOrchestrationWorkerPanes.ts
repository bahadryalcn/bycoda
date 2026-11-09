import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WorkerDetailRequest } from "./useOrchestrationState";
import {
  type WorkspaceTab,
  leafIds,
  newAgentTab,
  openEditorTab,
} from "../../../features/workspace/model/layout";
import { prepareOrchestrationWorkerDetails } from "../../../features/orchestration/model/orchestrationWorkspace";
import { type OrchestrationWorkerDetail } from "../../../features/orchestration/ui/OrchestrationActions";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";

export interface OrchestrationWorkerPanesDeps {
  tabs: WorkspaceTab[];
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  projectCwdRef: MutableRefObject<string>;
  focusOpenSession: (sessionId: string) => boolean;
  onSelectHistorySession: (
    sessionId: string,
    options?: { isCurrent?: () => boolean },
  ) => Promise<unknown>;
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
  const requestSerial = useRef(0);
  const requestGuards = useRef(new WeakMap<WorkerDetailRequest, () => boolean>());
  useEffect(
    () => () => {
      requestSerial.current++;
    },
    [],
  );
  const queueWorkerPanes = useCallback(
    async (workers: OrchestrationWorkerDetail[], isCurrent: () => boolean = () => true) => {
      const serial = ++requestSerial.current;
      const privacy = getGroupLockView();
      const current = () =>
        serial === requestSerial.current && getGroupLockView() === privacy && isCurrent();
      const accessible = (id: string) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        return (
          !!session && !session.inboxAsk && !isProjectLockedIn(getGroupLockView().lock, session.cwd)
        );
      };
      // Finished workers are not open; load stored transcripts before the
      // tabs appear so the pane does not flash the empty state.
      try {
        const request = await prepareOrchestrationWorkerDetails(workers, {
          openLead: async (leadId) => {
            if (!current()) return;
            const lead = await ensureOpenSession(leadId);
            if (!current() || !lead || !accessible(leadId)) return;
            if (!focusOpenSession(leadId))
              await onSelectHistorySession(leadId, { isCurrent: current });
          },
          openWorker: (id) => (current() ? ensureOpenSession(id) : Promise.resolve(null)),
          hasSession: (id) => current() && accessible(id),
        });
        if (!current() || !request?.workers.length) return false;
        requestGuards.current.set(request, current);
        setWorkerDetailRequest(request);
        return true;
      } catch (error) {
        if (current()) console.error(error);
        return false;
      }
    },
    [ensureOpenSession, focusOpenSession, onSelectHistorySession],
  );
  const onOpenWorkerDetails = useCallback(
    (worker: OrchestrationWorkerDetail) => {
      setInspectedWorkerId(worker.sessionId);
      void queueWorkerPanes([worker]);
    },
    [queueWorkerPanes],
  );
  useEffect(() => {
    if (!workerDetailRequest) return;
    const current = requestGuards.current.get(workerDetailRequest);
    if (current && !current()) {
      setWorkerDetailRequest((previous) => (previous === workerDetailRequest ? null : previous));
      return;
    }
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
    setWorkerDetailRequest((previous) => (previous === workerDetailRequest ? null : previous));
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
    setTabs((prev) => {
      if (current && !current()) return prev;
      return prev.map((entry) => {
        if (entry.id !== tab.id) return entry;
        const opened = files.reduce((next, file) => openEditorTab(next, file), entry);
        // Leave the first worker focused so View agents lands on the start
        // of the run rather than the last tab added.
        return files[0] ? openEditorTab(opened, files[0]) : opened;
      });
    });
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
