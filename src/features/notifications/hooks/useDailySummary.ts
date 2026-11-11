import { useEffect } from "react";
import { t } from "../../../shared/i18n";
import { formatActiveMinutes, getActivityTotals, yesterdayMinutes } from "../../activity";
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
import { withActiveYesterday } from "../model/dailySummaryActive";
import { loadNotificationsEnabled, notifyDailySummary } from "../model/notifications";
import { isLeadWindow } from "./useBackgroundNotifications";

const POLL_MS = 60_000;

type SummaryState = {
  cancelled: boolean;
  running: boolean;
  deliveredAt: number | null;
  // A dispatched summary whose durable records did not all stick. Retried on
  // every poll so a restart does not resend it or open an older cache.
  unsaved: { sentAt: boolean; summary: DailySummary | null } | null;
};

function reconcile(state: SummaryState) {
  const { unsaved, deliveredAt } = state;
  if (!unsaved || deliveredAt == null) return;
  if (unsaved.sentAt && saveDailySummarySentAt(deliveredAt)) unsaved.sentAt = false;
  if (unsaved.summary && saveStoredDailySummary(unsaved.summary) !== false) unsaved.summary = null;
  if (!unsaved.sentAt && !unsaved.summary) state.unsaved = null;
}

async function checkDailySummary(state: SummaryState, machineId: string | undefined) {
  if (state.running || state.cancelled) return;
  state.running = true;
  try {
    reconcile(state);
    const now = Date.now();
    const lastSentAt = Math.max(state.deliveredAt ?? 0, loadDailySummarySentAt() ?? 0) || null;
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
    if (state.cancelled) return;
    const summary = await gatherDailySummary(dailySummarySince(now, lastSentAt), now);
    if (state.cancelled) return;
    const cached = saveStoredDailySummary(summary) !== false;
    const totals = machineId ? await getActivityTotals(machineId) : null;
    if (state.cancelled) return;
    const headline = withActiveYesterday(
      summaryHeadline(summary),
      totals ? yesterdayMinutes(totals) : null,
      formatActiveMinutes,
      (value) => t("{p0} active yesterday", { p0: value }),
    );
    if (await notifyDailySummary(headline)) {
      state.deliveredAt = now;
      const sentSaved = saveDailySummarySentAt(now);
      if (!sentSaved || !cached) {
        state.unsaved = { sentAt: !sentSaved, summary: cached ? null : summary };
      }
    }
  } catch {
    // Tried again next time.
  } finally {
    state.running = false;
  }
}

/** Once a day, after the chosen time, gathers what the agents did on every
 * machine and announces it in one notification. An app that was closed at
 * that time sends it the first time it runs afterwards the same day. With the
 * local Host's `machineId` the headline also says how long the owner was
 * active yesterday. */
export function useDailySummary(machineId?: string) {
  useEffect(() => {
    const state: SummaryState = {
      cancelled: false,
      running: false,
      deliveredAt: null,
      unsaved: null,
    };
    void checkDailySummary(state, machineId);
    const timer = setInterval(() => void checkDailySummary(state, machineId), POLL_MS);
    return () => {
      state.cancelled = true;
      clearInterval(timer);
    };
  }, [machineId]);
}
