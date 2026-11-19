import { useRef, useState, type ReactNode } from "react";
import { t } from "../../i18n";
import { SettingsFeedback } from "./SettingsRows";

/** One requested preference value, as the owner's last click left it. */
export type ConfirmedPreferenceRequest = {
  /**
   * Persists the requested value. `false` or a throw is a refusal. A synchronous writer settles
   * within the call (no "Saving…" flash); a promise shows "Saving…" until it settles.
   */
  write: () => boolean | void | Promise<boolean | void>;
  /** True when storage now holds this request's value; catches writers that swallow a failed write. */
  verify?: () => boolean;
  /** Runs once, only for the request that is still the latest and was confirmed. */
  onConfirmed?: () => void;
};

type Lane = { running: boolean; queued: boolean; latest: ConfirmedPreferenceRequest };

const isPromise = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === "function";

/**
 * Pending and failure feedback for settings that save when changed, one lane per setting id.
 *
 * - Writes of one id never overlap; a change made while one is saving replaces any waiting
 *   change, so only the newest value is written next and an older value cannot overwrite it.
 * - A superseded request reports nothing. `verify` and the outcome belong to the latest request, so
 *   a quick second change cannot make the first one look like a failed save.
 * - Retry replays the latest requested value for that id and touches no other setting.
 * - A write continues if the page unmounts; only the feedback is dropped.
 *
 * Give each control `disabled={pending(id)}` so its displayed value cannot go stale while saving.
 */
export function useConfirmedPreferences() {
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const lanes = useRef(new Map<string, Lane>());

  const flag = (id: string, on: boolean, set: typeof setPendingIds) =>
    set((current) => {
      if (Boolean(current[id]) === on) return current;
      const next = { ...current };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });

  const settled = (request: ConfirmedPreferenceRequest, written: unknown) => {
    try {
      return written !== false && (request.verify?.() ?? true);
    } catch {
      return false;
    }
  };

  const drain = async (id: string, lane: Lane) => {
    lane.running = true;
    let showingPending = false;
    try {
      while (lane.queued) {
        lane.queued = false;
        const request = lane.latest;
        let written: unknown = false;
        try {
          const result = request.write();
          if (isPromise(result)) {
            if (!showingPending) {
              showingPending = true;
              flag(id, true, setPendingIds);
            }
            written = await result;
          } else written = result;
        } catch {
          written = false;
        }
        // A newer value is waiting: only its outcome matters, so this one reports nothing.
        if (lane.queued) continue;
        const ok = settled(request, written);
        flag(id, !ok, setFailedIds);
        if (ok) request.onConfirmed?.();
      }
    } finally {
      lane.running = false;
      if (showingPending) flag(id, false, setPendingIds);
    }
  };

  const commit = (id: string, request: ConfirmedPreferenceRequest) => {
    let lane = lanes.current.get(id);
    if (!lane) {
      lane = { running: false, queued: false, latest: request };
      lanes.current.set(id, lane);
    }
    lane.latest = request;
    lane.queued = true;
    if (!lane.running) void drain(id, lane).catch(console.error);
  };

  const retry = (id: string) => {
    const lane = lanes.current.get(id);
    if (lane) commit(id, lane.latest);
  };

  const pending = (id: string) => pendingIds[id] === true;

  const feedback = (id: string): ReactNode =>
    pendingIds[id] ? (
      <SettingsFeedback state="loading" immediate>
        {t("Saving…")}
      </SettingsFeedback>
    ) : failedIds[id] ? (
      <SettingsFeedback state="error" action={{ label: t("Retry"), onClick: () => retry(id) }}>
        {t("Could not save changes")}
      </SettingsFeedback>
    ) : undefined;

  return { commit, pending, feedback };
}
