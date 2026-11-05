import { createStore } from "../../../shared/lib/store";

export type SessionDeletionStage =
  | "preparing"
  | "stopping"
  | "provider"
  | "checkpoint"
  | "deleting"
  | "worktree";
export type SessionDeletionStatus = {
  sessionId: string;
  cwd: string;
  title: string;
  stage: SessionDeletionStage;
  startedAt: number;
  outcome?: "deleted" | "failed";
  error?: string;
};

let snapshot: readonly SessionDeletionStatus[] = [];
const store = createStore();
export const getSessionDeletionStatus = () => snapshot;
export const subscribeSessionDeletionStatus = store.subscribe;

export function setSessionDeletionStatus(status: SessionDeletionStatus) {
  // Successful removal is already visible in the list. Keep only progress and
  // outcomes that need attention, without requiring a second dismissal.
  snapshot = [
    ...snapshot.filter((entry) => !entry.outcome && entry.sessionId !== status.sessionId),
    ...(status.outcome === "deleted" && !status.error ? [] : [status]),
  ];
  store.notify();
}

export function dismissSessionDeletionStatus(sessionId: string) {
  snapshot = snapshot.filter((entry) => entry.sessionId !== sessionId);
  store.notify();
}
