import { useEffect, useState } from "react";
import type { ActivitySummary } from "@bycoda/account-contracts/activity";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { getActivityTotals } from "../model/activityTotals";

const REFRESH_MS = 60_000;

/**
 * Totals from this computer's Host, refreshed every minute while the window is visible; null
 * until the first answer. Hidden windows stop polling, and becoming visible loads again at once.
 */
export function useActivitySummary(machineId: string | undefined): {
  summary: ActivitySummary | null;
  failed: boolean;
} {
  const [state, setState] = useState<{
    summary: ActivitySummary | null;
    failed: boolean;
  }>({
    summary: null,
    failed: false,
  });
  const visible = useQueryVisible();
  // Syncs the Host totals for `machineId` into state; `visible` starts and stops the polling.
  useEffect(() => {
    if (!machineId || !visible) return;
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      // A slow Host must not stack requests: a tick during a pending load is dropped.
      if (inFlight) return;
      inFlight = true;
      try {
        const summary = await getActivityTotals(machineId);
        if (cancelled) return;
        setState((current) => ({
          summary: summary ?? current.summary,
          failed: summary === null,
        }));
      } finally {
        inFlight = false;
      }
    };
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [machineId, visible]);
  return state;
}
