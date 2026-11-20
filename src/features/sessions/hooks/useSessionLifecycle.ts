import { useCallback, useEffect } from "react";
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
