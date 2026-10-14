import type { Dispatch, SetStateAction } from "react";
import { type OrchestrationWorkerDetail } from "../../../features/orchestration/ui/OrchestrationActions";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { useState, useSyncExternalStore } from "react";

export interface WorkerDetailRequest {
  leadId: string;
  workers: OrchestrationWorkerDetail[];
}

export interface OrchestrationState {
  inspectedWorkerId: string | null;
  setInspectedWorkerId: Dispatch<SetStateAction<string | null>>;
  workerDetailRequest: WorkerDetailRequest | null;
  setWorkerDetailRequest: Dispatch<SetStateAction<WorkerDetailRequest | null>>;
  orchestrationRuns: ReturnType<typeof orchestrator.snapshot>;
}

export function useOrchestrationState(): OrchestrationState {
  const [inspectedWorkerId, setInspectedWorkerId] = useState<string | null>(null);
  // Set while the lead's tab is still opening; the agent tab lands on the
  // commit that brings it in.
  const [workerDetailRequest, setWorkerDetailRequest] = useState<{
    leadId: string;
    workers: OrchestrationWorkerDetail[];
  } | null>(null);
  const orchestrationRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  return { inspectedWorkerId, setInspectedWorkerId, workerDetailRequest, setWorkerDetailRequest, orchestrationRuns };
}
