import { useEffect, useRef } from "react";
import {
  assistantRequest,
  latestAssistantSnapshot,
  watchAssistantSnapshot,
  useAssistantSnapshot,
  type AssistantClientState,
} from "../model/assistantClient";
import {
  AssistantNotificationDelivery,
  currentNotification,
  type AssistantNotificationInput,
} from "../model/assistantNotifications";
import { msUntilClockTime } from "../model/assistantBriefing";
import { isLeadWindow } from "../../notifications/hooks/useBackgroundNotifications";
import { notifyAssistant } from "../../notifications/model/notifications";
import {
  loadDailySummaryEnabled,
  loadDailySummaryTime,
  subscribeDailySummary,
} from "../../notifications/model/dailySummarySettings";

function notificationStorage() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

// Reads: profile.enabled, profile.setupComplete and the first five notifications' id/eligible.
function selectDelivery(state: AssistantClientState): AssistantNotificationInput | null {
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  return {
    profile: { enabled: snapshot.profile.enabled, setupComplete: snapshot.profile.setupComplete },
    notifications: (snapshot.notifications ?? [])
      .slice(0, 5)
      .map(({ id, eligible }) => ({ id, eligible })),
  };
}
function sameDelivery(a: AssistantNotificationInput | null, b: AssistantNotificationInput | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Main-window bridge. No permission prompt, microphone, or background execution grant. */
export function AssistantNotifications() {
  const snapshot = useAssistantSnapshot(selectDelivery, sameDelivery);
  const current = useRef(snapshot);
  current.current = snapshot;
  const pump = useRef<AssistantNotificationDelivery | null>(null);
  if (!pump.current)
    pump.current = new AssistantNotificationDelivery({
      request: assistantRequest,
      lead: isLeadWindow,
      current: async (id) => currentNotification(latestAssistantSnapshot(), id),
      storage: notificationStorage(),
      projectPath: async (id) =>
        (await assistantRequest({ op: "projects.list" })).projects?.find(
          (project) => project.id === id,
        )?.path,
      deliver: (notification, projectPath, projectPaths) =>
        notifyAssistant({
          title: notification.title,
          body: notification.body,
          kind:
            notification.kind === "job.waiting" ||
            notification.kind === "job.stalled" ||
            notification.kind === "reminder" ||
            notification.kind === "task.needsInput"
              ? "input"
              : notification.kind === "job.failed" || notification.kind === "budget.exhausted"
                ? "failed"
                : "finished",
          projectPath,
          projectPaths,
          occurredAt: notification.createdAt,
        }),
    });
  // Delivery and acknowledgement retries run on every snapshot change, heartbeat included,
  // so they follow the store instead of this bridge's narrower render selection.
  useEffect(() => {
    const check = (input: AssistantNotificationInput | null) => {
      if (input) void pump.current!.check(input).catch(() => undefined);
    };
    check(current.current);
    return watchAssistantSnapshot((state) => check(selectDelivery(state)));
  }, []);
  const ready = snapshot?.profile.enabled === true && snapshot.profile.setupComplete;
  // Effect reason: the daily-summary schedule and its due-time check. It re-runs when the
  // Assistant becomes ready, so a late snapshot is picked up without a polling interval (#315).
  useEffect(() => {
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      running = false,
      preparedDay = "",
      scheduleKey = "",
      settingsChanged = false;
    const check = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        if (!(await isLeadWindow()) || cancelled) return;
        const enabled = loadDailySummaryEnabled(),
          time = loadDailySummaryTime(),
          key = JSON.stringify({ enabled, time });
        if (key !== scheduleKey) {
          await assistantRequest({ op: "briefing.schedule", enabled, time });
          scheduleKey = key;
        }
        if (cancelled) return;
        const state = current.current;
        if (!state?.profile.enabled || !state.profile.setupComplete || !loadDailySummaryEnabled())
          return;
        const now = new Date();
        if (
          now.getHours() * 60 + now.getMinutes() <
          Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
        )
          return;
        const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        if (day !== preparedDay && !cancelled) {
          await assistantRequest({ op: "briefing.daily", day });
          preparedDay = day;
        }
      } catch {
        /* The current Host read error remains in the shared snapshot state. */
      } finally {
        running = false;
        if (settingsChanged && !cancelled) {
          settingsChanged = false;
          void check();
        } else arm();
      }
    };
    // Snapshot readiness and settings changes re-check independently of the due-time timer.
    const arm = () => {
      clearTimeout(timer);
      if (cancelled) return;
      const now = new Date();
      timer = setTimeout(() => void check(), msUntilClockTime(loadDailySummaryTime(), now));
    };
    const onVisibility = () => arm();
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = subscribeDailySummary(() => {
      settingsChanged = true;
      if (!running) {
        settingsChanged = false;
        void check();
      }
    });
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [ready]);
  return null;
}
