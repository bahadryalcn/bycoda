import { useSyncExternalStore } from "react";
import { remoteRequest } from "../../connections/public/connections";
import type { AutoSettleSettings, SessionLifecycleView } from "./sessionLifecycle";

export interface SessionLifecycleList {
  records: SessionLifecycleView[];
  autoSettle: AutoSettleSettings;
}

/** Typed wrappers for the `sessions.lifecycle.*` and `sessions.taskLink.*` Host methods. */
export function sessionLifecycleClient(machineId: string) {
  return {
    get: (sessionId: string) =>
      remoteRequest<SessionLifecycleView>(machineId, "sessions.lifecycle.get", { sessionId }),
    list: () => remoteRequest<SessionLifecycleList>(machineId, "sessions.lifecycle.list", {}),
    settle: (sessionId: string) =>
      remoteRequest<SessionLifecycleView>(machineId, "sessions.lifecycle.settle", { sessionId }),
    unsettle: (sessionId: string) =>
      remoteRequest<SessionLifecycleView>(machineId, "sessions.lifecycle.unsettle", {
        sessionId,
      }),
    configure: (settings: AutoSettleSettings) =>
      remoteRequest<AutoSettleSettings>(machineId, "sessions.lifecycle.configure", settings),
    taskFor: async (sessionId: string) =>
      (
        await remoteRequest<{ taskId: string | null }>(machineId, "sessions.taskLink.get", {
          sessionId,
        })
      ).taskId,
    link: (sessionId: string, taskId: string) =>
      remoteRequest<unknown>(machineId, "sessions.taskLink.link", { sessionId, taskId }),
    unlink: (sessionId: string) =>
      remoteRequest<{ unlinked: boolean }>(machineId, "sessions.taskLink.unlink", { sessionId }),
  };
}

/** Last known lifecycle of this computer's Host sessions, shared by header, sidebar and settings. */
type Snapshot = {
  views: ReadonlyMap<string, SessionLifecycleView>;
  autoSettle?: AutoSettleSettings;
};
let snapshot: Snapshot = { views: new Map() };
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function setSessionLifecycle(view: SessionLifecycleView): void {
  publish({ ...snapshot, views: new Map(snapshot.views).set(view.sessionId, view) });
}

/** A full list holds every non-active record; any other known session is active now. */
export function setSessionLifecycleList(list: SessionLifecycleList): void {
  const views = new Map<string, SessionLifecycleView>();
  for (const [id, view] of snapshot.views)
    views.set(id, { sessionId: id, state: "active", participants: view.participants });
  for (const record of list.records) views.set(record.sessionId, record);
  publish({ views, autoSettle: list.autoSettle });
}

export function setAutoSettleSettings(autoSettle: AutoSettleSettings): void {
  publish({ ...snapshot, autoSettle });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionLifecycleView(sessionId: string): SessionLifecycleView | undefined {
  return useSyncExternalStore(subscribe, () => snapshot.views.get(sessionId));
}

export function useSessionLifecycleSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** The Host answered a lifecycle list, so it supports settling. */
export function useSessionLifecycleSupported(): boolean {
  return useSyncExternalStore(subscribe, () => snapshot.autoSettle !== undefined);
}
