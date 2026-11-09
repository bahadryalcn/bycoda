import { useCallback, useEffect } from "react";
import { useLocalLifecycleMachine } from "./useLocalLifecycleMachine";
import {
  sessionLifecycleClient,
  setAutoSettleSettings,
  setSessionLifecycle,
  setSessionLifecycleList,
  useSessionLifecycleSnapshot,
  useSessionLifecycleView,
} from "../model/sessionLifecycleClient";
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
    const load = () =>
      sessionLifecycleClient(machineId)
        .get(sessionId)
        .then((next) => {
          if (!cancelled) setSessionLifecycle(next);
        })
        .catch(() => undefined); // -- an older Host without settle support shows no control.
    load();
    if (state !== "settling") return () => void (cancelled = true);
    const timer = window.setInterval(load, POLL_SETTLING_MS);
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
    let cancelled = false;
    const load = () =>
      sessionLifecycleClient(machineId)
        .list()
        .then((list) => {
          if (!cancelled) setSessionLifecycleList(list);
        })
        .catch(() => undefined); // -- an older Host has no shelf; every session stays in the list.
    load();
    const timer = window.setInterval(load, REFRESH_LIST_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [enabled, machineId]);
  return { machineId, ...useSessionLifecycleSnapshot() };
}

/** The Host's automatic settling window; undefined while unknown or on an older Host. */
export function useAutoSettleSetting() {
  const { machineId, autoSettle } = useSessionLifecycleList();
  const change = useCallback(
    async (settings: AutoSettleSettings) => {
      if (!machineId) return;
      setAutoSettleSettings(await sessionLifecycleClient(machineId).configure(settings));
    },
    [machineId],
  );
  return machineId && autoSettle ? { afterDays: autoSettle.afterDays, change } : undefined;
}
