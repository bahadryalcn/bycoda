import { useEffect } from "react";
import { summaryHeadline, type DailySummary } from "../../tasks/model/dailySummary";
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
    let deliveredAt: number | null = null;
    // A dispatched summary whose durable records did not all stick. Retried on
    // every poll so a restart does not resend it or open an older cache.
    let unsaved: { sentAt: boolean; summary: DailySummary | null } | null = null;
    const reconcile = () => {
      if (!unsaved || deliveredAt == null) return;
      if (unsaved.sentAt && saveDailySummarySentAt(deliveredAt)) unsaved.sentAt = false;
      if (unsaved.summary && saveStoredDailySummary(unsaved.summary) !== false)
        unsaved.summary = null;
      if (!unsaved.sentAt && !unsaved.summary) unsaved = null;
    };
    const check = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        reconcile();
        const now = Date.now();
        const lastSentAt = Math.max(deliveredAt ?? 0, loadDailySummarySentAt() ?? 0) || null;
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
        if (cancelled) return;
        const summary = await gatherDailySummary(dailySummarySince(now, lastSentAt), now);
        if (cancelled) return;
        const cached = saveStoredDailySummary(summary) !== false;
        if (await notifyDailySummary(summaryHeadline(summary))) {
          deliveredAt = now;
          const sentSaved = saveDailySummarySentAt(deliveredAt);
          if (!sentSaved || !cached) {
            unsaved = { sentAt: !sentSaved, summary: cached ? null : summary };
          }
        }
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
