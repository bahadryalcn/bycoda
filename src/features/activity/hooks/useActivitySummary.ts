import { useEffect, useState } from "react";
import type { ActivitySummary } from "@bycoda/account-contracts/activity";
import { getActivityTotals } from "../model/activityTotals";

const REFRESH_MS = 60_000;

/** Totals from this computer's Host, refreshed every minute; null until the first answer. */
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
  useEffect(() => {
    if (!machineId) return;
    let cancelled = false;
    const load = async () => {
      const summary = await getActivityTotals(machineId);
      if (cancelled) return;
      setState((current) => ({
        summary: summary ?? current.summary,
        failed: summary === null,
      }));
    };
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [machineId]);
  return state;
}
