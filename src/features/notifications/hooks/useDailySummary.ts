import { useEffect } from "react";
import { summaryHeadline } from "../../tasks/model/dailySummary";
import { gatherDailySummary, saveStoredDailySummary } from "../../tasks/model/dailySummaryClient";
import {
  dailySummaryDue,
  dailySummarySince,
  loadDailySummaryEnabled,
  loadDailySummarySentAt,
  loadDailySummaryTime,
  saveDailySummarySentAt,
} from "../model/dailySummarySettings";
import { loadNotificationsEnabled, notifyDailySummary } from "../model/notifications";
import { isLeadWindow } from "./useBackgroundNotifications";

const POLL_MS = 60_000;

/** Once a day, after the chosen time, gathers what the agents did on every
 * machine and announces it in one notification. An app that was closed at
 * that time sends it the first time it runs afterwards the same day. */
export function useDailySummary() {
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const check = async () => {
      if (running) return;
      const now = Date.now();
      const lastSentAt = loadDailySummarySentAt();
      if (
        !loadNotificationsEnabled() ||
        !dailySummaryDue({
          enabled: loadDailySummaryEnabled(),
          time: loadDailySummaryTime(),
          now,
          lastSentAt,
        }) ||
        !(await isLeadWindow())
      )
        return;
      running = true;
      try {
        const summary = await gatherDailySummary(dailySummarySince(now, lastSentAt), now);
        if (cancelled) return;
        saveStoredDailySummary(summary);
        saveDailySummarySentAt(now);
        void notifyDailySummary(summaryHeadline(summary));
      } catch {
        // Tried again next time.
      } finally {
        running = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
