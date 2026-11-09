import { useEffect, useRef } from "react";
import { assistantRequest, refreshAssistant, useAssistantSnapshot } from "../model/assistantClient";
import { AssistantNotificationDelivery } from "../model/assistantNotifications";
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

/** Main-window bridge. No permission prompt, microphone, or background execution grant. */
export function AssistantNotifications() {
  const { snapshot } = useAssistantSnapshot();
  const current = useRef(snapshot);
  current.current = snapshot;
  const pump = useRef<AssistantNotificationDelivery | null>(null);
  if (!pump.current)
    pump.current = new AssistantNotificationDelivery({
      request: assistantRequest,
      lead: isLeadWindow,
      current: async (id) => {
        const state = (
          await assistantRequest({
            op: "snapshot",
            limit: 100,
            features: ["jobHolds", "jobStalled"],
          })
        ).snapshot;
        return state?.profile.enabled && state.profile.setupComplete
          ? state.notifications?.find((notification) => notification.id === id)
          : undefined;
      },
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
  useEffect(() => {
    if (snapshot) void pump.current!.check(snapshot).catch(() => undefined);
  }, [snapshot]);
  useEffect(() => {
    let cancelled = false,
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
        // Keep notification intake alive when the main webview is in the background.
        await refreshAssistant();
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
        }
      }
    };
    const unsubscribe = subscribeDailySummary(() => {
      settingsChanged = true;
      if (!running) {
        settingsChanged = false;
        void check();
      }
    });
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  return null;
}
