import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLocalLifecycleMachine } from "./useLocalLifecycleMachine";
import {
  applyLifecycleListRead,
  applyLifecycleViewRead,
  beginLifecycleRead,
  sessionLifecycleClient,
  setAutoSettleSettings,
  useSessionLifecycleSnapshot,
  useSessionLifecycleView,
} from "../model/sessionLifecycleClient";
import { subscribeSharedRead } from "../model/sharedLifecycleRead";
import type { AutoSettleSettings, SessionLifecycleView } from "../model/sessionLifecycle";

const POLL_SETTLING_MS = 3000;
const REFRESH_LIST_MS = 60_000;

/**
 * Loads the lifecycle of one session of this computer's Host and keeps it fresh while a settle
 * waits for the turn. Undefined while unknown, for other Hosts, or on an older Host.
 */
export function useSessionLifecycle(
  sessionId: string,
  local: boolean,
): SessionLifecycleView | undefined {
  const machineId = useLocalLifecycleMachine();
  const view = useSessionLifecycleView(sessionId);
  const state = view?.state;
  useEffect(() => {
    if (!local || !machineId) return;
    let cancelled = false;
    const load = () => {
      const readAt = beginLifecycleRead();
      return sessionLifecycleClient(machineId)
        .get(sessionId)
        .then((next) => {
          if (!cancelled) applyLifecycleViewRead(next, readAt);
        })
        .catch(() => undefined); // -- an older Host without settle support shows no control.
    };
    load();
    if (state !== "settling") return () => void (cancelled = true);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_SETTLING_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [local, machineId, sessionId, state]);
  return local && machineId ? view : undefined;
}

/**
 * Keeps the settled records of this computer's Host fresh for the sidebar shelf and settings:
 * on mount, when the window regains focus and every minute (automatic settling runs hourly).
 */
export function useSessionLifecycleList(enabled = true) {
  const machineId = useLocalLifecycleMachine();
  useEffect(() => {
    if (!enabled || !machineId) return;
    return subscribeSharedRead(
      `list:${machineId}`,
      (isCurrent) => {
        const readAt = beginLifecycleRead();
        return sessionLifecycleClient(machineId)
          .list()
          .then((list) => {
            if (isCurrent()) applyLifecycleListRead(list, readAt);
          })
          .catch(() => undefined); // -- an older Host has no shelf; every session stays in the list.
      },
      { intervalMs: REFRESH_LIST_MS, refreshOnFocus: true },
    );
  }, [enabled, machineId]);
  return { machineId, ...useSessionLifecycleSnapshot() };
}

let remoteLists: ReadonlyMap<string, ReadonlyMap<string, SessionLifecycleView>> = new Map();
const remoteRevisions = new Map<string, number>();
const remoteListeners = new Set<() => void>();

function publishRemoteList(machineId: string, records: ReadonlyMap<string, SessionLifecycleView>) {
  remoteLists = new Map(remoteLists).set(machineId, records);
  for (const listener of remoteListeners) listener();
}

function subscribeRemoteLists(listener: () => void) {
  remoteListeners.add(listener);
  return () => remoteListeners.delete(listener);
}

const subscribeNothing = () => () => {};

async function changeRemoteLifecycle(machineId: string, sessionId: string, undo: boolean) {
  const client = sessionLifecycleClient(machineId, false);
  const view = await (undo ? client.unsettle(sessionId) : client.settle(sessionId));
  remoteRevisions.set(machineId, (remoteRevisions.get(machineId) ?? 0) + 1);
  publishRemoteList(machineId, new Map(remoteLists.get(machineId)).set(sessionId, view));
}

/** The header, project shelf and recent list share a lifecycle snapshot per owning Host. */
export function useRemoteSessionLifecycleLists(machineKey: string) {
  const lists = useSyncExternalStore(
    machineKey ? subscribeRemoteLists : subscribeNothing,
    () => remoteLists,
  );
  const machineIds = machineKey ? (JSON.parse(machineKey) as string[]) : [];
  const pending = machineIds.some((machineId) =>
    [...(lists.get(machineId)?.values() ?? [])].some((view) => view.state === "settling"),
  );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Subscribe to lifecycle reads for the visible remote Hosts.
  useEffect(() => {
    if (!machineKey) return;
    const stops = (JSON.parse(machineKey) as string[]).map((machineId) =>
      subscribeSharedRead(
        `remote-lifecycle-list:${machineId}:${pending}`,
        async (isCurrent) => {
          const revision = remoteRevisions.get(machineId);
          const { records } = await sessionLifecycleClient(machineId, false).list();
          if (isCurrent() && revision === remoteRevisions.get(machineId))
            publishRemoteList(machineId, new Map(records.map((view) => [view.sessionId, view])));
        },
        { intervalMs: pending ? POLL_SETTLING_MS : REFRESH_LIST_MS, refreshOnFocus: true },
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [machineKey, pending]);
  return { lists, change: changeRemoteLifecycle };
}

/**
 * The Host's automatic settling and archiving windows; undefined while unknown or on an older Host.
 * `archiveAfterDays` is undefined on a Host without automatic archiving; `change` sets only the
 * windows it names and the Host keeps the saved value of any other.
 */
export function useAutoSettleSetting() {
  const { machineId, autoSettle } = useSessionLifecycleList();
  const change = useCallback(
    async (settings: Partial<AutoSettleSettings>) => {
      if (!machineId) return;
      setAutoSettleSettings(await sessionLifecycleClient(machineId).configure(settings));
    },
    [machineId],
  );
  return machineId && autoSettle
    ? { afterDays: autoSettle.afterDays, archiveAfterDays: autoSettle.archiveAfterDays, change }
    : undefined;
}
