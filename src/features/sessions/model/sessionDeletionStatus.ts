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
const listeners = new Set<() => void>();
export const getSessionDeletionStatus = () => snapshot;
export const subscribeSessionDeletionStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setSessionDeletionStatus(status: SessionDeletionStatus) {
  snapshot = [
    ...snapshot.filter((entry) => !entry.outcome && entry.sessionId !== status.sessionId),
    status,
  ];
  listeners.forEach((listener) => listener());
}

export function dismissSessionDeletionStatus(sessionId: string) {
  snapshot = snapshot.filter((entry) => entry.sessionId !== sessionId);
  listeners.forEach((listener) => listener());
}
