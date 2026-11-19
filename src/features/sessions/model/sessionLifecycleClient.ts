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
      confirmedMutation(
        remoteRequest<SessionLifecycleView>(machineId, "sessions.lifecycle.settle", { sessionId }),
      ),
    unsettle: (sessionId: string) =>
      confirmedMutation(
        remoteRequest<SessionLifecycleView>(machineId, "sessions.lifecycle.unsettle", {
          sessionId,
        }),
      ),
    configure: (settings: Partial<AutoSettleSettings>) =>
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

/** Field by field: a repeated payload is the same record, whatever its object identity. */
function sameView(a: SessionLifecycleView, b: SessionLifecycleView): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.state === b.state &&
    a.settleRequestedAt === b.settleRequestedAt &&
    a.settledAt === b.settledAt &&
    a.settledBy === b.settledBy &&
    a.keepActive === b.keepActive &&
    a.participants.length === b.participants.length &&
    a.participants.every(
      (p, i) => p.userId === b.participants[i].userId && p.role === b.participants[i].role,
    )
  );
}

function sameAutoSettle(a: AutoSettleSettings | undefined, b: AutoSettleSettings): boolean {
  return a !== undefined && a.afterDays === b.afterDays && a.archiveAfterDays === b.archiveAfterDays;
}

/** Repeated records keep the stored object, so their subscribers and the snapshot stay unchanged. */
export function setSessionLifecycle(view: SessionLifecycleView): void {
  const current = snapshot.views.get(view.sessionId);
  if (current && sameView(current, view)) return;
  publish({ ...snapshot, views: new Map(snapshot.views).set(view.sessionId, view) });
}

/**
 * A full list holds every non-active record; any other known session is active now. A list that
 * changes no record and no window keeps the snapshot object itself.
 */
export function setSessionLifecycleList(list: SessionLifecycleList): void {
  const views = new Map<string, SessionLifecycleView>();
  for (const [id, view] of snapshot.views) {
    const active: SessionLifecycleView = { sessionId: id, state: "active", participants: view.participants };
    views.set(id, sameView(view, active) ? view : active);
  }
  for (const record of list.records) {
    const current = snapshot.views.get(record.sessionId);
    views.set(record.sessionId, current && sameView(current, record) ? current : record);
  }
  const unchanged =
    views.size === snapshot.views.size &&
    [...views].every(([id, view]) => snapshot.views.get(id) === view) &&
    sameAutoSettle(snapshot.autoSettle, list.autoSettle);
  if (unchanged) return;
  publish({ views, autoSettle: list.autoSettle });
}

export function setAutoSettleSettings(autoSettle: AutoSettleSettings): void {
  publish({ ...snapshot, autoSettle });
}

let generation = 0;
const confirmedAt = new Map<string, number>();

async function confirmedMutation(request: Promise<SessionLifecycleView>) {
  const view = await request;
  confirmedAt.set(view.sessionId, ++generation);
  return view;
}

const supersededBy = (sessionId: string, readAt: number) =>
  (confirmedAt.get(sessionId) ?? 0) > readAt;

export function beginLifecycleRead(): number {
  return ++generation;
}

export function applyLifecycleViewRead(view: SessionLifecycleView, readAt: number): void {
  if (supersededBy(view.sessionId, readAt)) return;
  setSessionLifecycle(view);
}

export function applyLifecycleListRead(list: SessionLifecycleList, readAt: number): void {
  const records = list.records.filter((record) => !supersededBy(record.sessionId, readAt));
  for (const [id, view] of snapshot.views) if (supersededBy(id, readAt)) records.push(view);
  setSessionLifecycleList({ ...list, records });
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
