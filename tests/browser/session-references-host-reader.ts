import { useSyncExternalStore } from "react";
import type { Session } from "../../src/features/sessions/model/session";
import type { useReadOnlyHostSession as ProductReader } from "../../src/features/sessions/ui/useReadOnlyHostSession";

// In-memory transport for the actual AgentTabView/AgentTranscript. This fixture
// deliberately provides no Host connectivity or mutation/continuation owners.
export type WorkerMode = "ready" | "loading" | "error";
let mode: WorkerMode = "ready";
const listeners = new Set<() => void>();
export function setFixtureWorkerMode(next: WorkerMode) {
  mode = next;
  for (const listener of listeners) listener();
}
export function useReadOnlyHostSession(
  shell: Session,
  _visible: boolean,
): ReturnType<typeof ProductReader> {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => mode,
  );
  return {
    session: {
      ...shell,
      blocks: state === "ready" ? shell.blocks : [],
      historyLoading: state === "loading",
    },
    error: state === "error" ? "Local Host is temporarily unavailable." : undefined,
    retry: () => setFixtureWorkerMode("ready"),
    remoteHistoryHasMore: false,
    remoteHistoryLoading: false,
    remoteHistoryError: undefined,
    onLoadRemoteHistory: async () => 0,
    onLoadRemoteBlock: async () => {},
  };
}
