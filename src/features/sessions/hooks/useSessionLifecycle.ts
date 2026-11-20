import { useCallback, useEffect, useId, useRef, useState } from "react";
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

/** Recent sessions can span several Hosts. Keep their records separate from the local shelf. */
export function useRemoteSessionLifecycleLists(machineKey: string) {
  const scope = useId();
  const [lists, setLists] = useState<
    ReadonlyMap<string, ReadonlyMap<string, SessionLifecycleView>>
  >(() => new Map());
  const revisions = useRef(new Map<string, number>());
  const pending = [...lists.values()].some((views) =>
    [...views.values()].some((view) => view.state === "settling"),
  );
  const publish = useCallback(
    (machineId: string, records: ReadonlyMap<string, SessionLifecycleView>) => {
      setLists((current) => new Map(current).set(machineId, records));
    },
    [],
  );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Subscribe to lifecycle reads for the visible remote Hosts.
  useEffect(() => {
    if (!machineKey) return;
    const stops = (JSON.parse(machineKey) as string[]).map((machineId) =>
      subscribeSharedRead(
        `recent-remote-list:${scope}:${machineId}`,
        async (isCurrent) => {
          const revision = revisions.current.get(machineId);
          const { records } = await sessionLifecycleClient(machineId, false).list();
          if (isCurrent() && revision === revisions.current.get(machineId))
            publish(machineId, new Map(records.map((view) => [view.sessionId, view])));
        },
        { intervalMs: pending ? POLL_SETTLING_MS : REFRESH_LIST_MS, refreshOnFocus: true },
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [machineKey, pending, publish, scope]);
  const change = async (machineId: string, sessionId: string, undo: boolean) => {
    const client = sessionLifecycleClient(machineId, false);
    const view = await (undo ? client.unsettle(sessionId) : client.settle(sessionId));
    revisions.current.set(machineId, (revisions.current.get(machineId) ?? 0) + 1);
    setLists((current) =>
      new Map(current).set(machineId, new Map(current.get(machineId)).set(sessionId, view)),
    );
  };
  return { lists, change };
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
