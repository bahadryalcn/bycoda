import { useEffect, useState } from "react";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  DAILY_SUMMARY_TIMES,
  loadDailySummaryEnabled,
  loadDailySummaryTime,
  saveDailySummaryEnabled,
  saveDailySummaryTime,
} from "../../notifications/model/dailySummarySettings";
import {
  NOTIFICATION_EVENT_SETTINGS,
  loadNotificationEvents,
  saveNotificationEvent,
} from "../../notifications/model/notificationEvents";
import {
  cachedNotificationPermission,
  loadNotificationsEnabled,
  openNotificationSettings,
  probeNotificationPermission,
  requestNotificationPermission,
  saveNotificationsEnabled,
  type NotificationPermission,
} from "../../notifications/model/notifications";
import { loadSoundsEnabled, saveSoundsEnabled } from "../model/sounds";
import { Group, Row, Select, Toggle } from "./settingsControls";

export function NotificationAlerts() {
  useLocale();
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(loadNotificationsEnabled);
  const [notificationEvents, setNotificationEvents] = useState(loadNotificationEvents);
  const [summaryEnabled, setSummaryEnabled] = useState(loadDailySummaryEnabled);
  const [summaryTime, setSummaryTime] = useState(loadDailySummaryTime);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    cachedNotificationPermission,
  );
  useEffect(() => {
    if (!notificationsEnabled) return;
    const refresh = () => {
      void probeNotificationPermission().then(setNotificationPermission);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [notificationsEnabled]);
  const onSoundsEnabled = (next: boolean) => {
    saveSoundsEnabled(next);
    setSoundsEnabled(next);
  };
  const onNotificationsEnabled = (next: boolean) => {
    saveNotificationsEnabled(next);
    setNotificationsEnabled(next);
    if (!next) return;
    void requestNotificationPermission().then(setNotificationPermission);
  };
  return (
    <>
      <Group
        title={t("Alerts")}
        description={t("How {p0} reaches you while you are looking somewhere else.", {
          p0: PRODUCT_IDENTITY.displayName,
        })}
      >
        <Row
          id="sounds"
          label={t("Sounds")}
          description={t(
            "Short cues for project activity, finished turns and available updates. Choose categories under Project notifications below.",
          )}
        >
          <Toggle label={t("Sounds")} on={soundsEnabled} onChange={onSoundsEnabled} />
        </Row>
        <Row
          id="notifications"
          label={t("Notifications")}
          description={t(
            "Notify when a reminder is due, or when an agent finishes or needs input in another session or while {p0} is in the background. Click the notification to open that session.",
            { p0: PRODUCT_IDENTITY.displayName },
          )}
        >
          {notificationsEnabled && notificationPermission === "denied" ? (
            <NotificationsBlocked />
          ) : null}
          {notificationsEnabled && notificationPermission === "unsupported" ? (
            <span className="text-[12px] text-content/45">
              {t("Not available on this platform")}
            </span>
          ) : null}
          <Toggle
            label={t("Notifications")}
            on={notificationsEnabled}
            onChange={onNotificationsEnabled}
          />
        </Row>
        {notificationsEnabled
          ? NOTIFICATION_EVENT_SETTINGS.map((event) => (
              <Row key={event.id} label={event.label} description={event.description}>
                <Toggle
                  label={event.label}
                  on={notificationEvents[event.id]}
                  onChange={(on) => {
                    saveNotificationEvent(event.id, on);
                    setNotificationEvents(loadNotificationEvents());
                  }}
                />
              </Row>
            ))
          : null}
        {
          <Row
            id="daily-summary"
            label={t("Daily summary")}
            description={t(
              "Once a day, one notification with what background tasks and goals did on every machine. Click it to open the summary.",
            )}
          >
            {summaryEnabled ? (
              <Select
                label={t("Daily summary time")}
                value={summaryTime}
                options={DAILY_SUMMARY_TIMES.map((time) => ({
                  value: time,
                  label: time,
                }))}
                onChange={(time) => {
                  saveDailySummaryTime(time);
                  setSummaryTime(time);
                }}
                disabled={!notificationsEnabled}
              />
            ) : null}
            <Toggle
              label={t("Daily summary")}
              on={summaryEnabled}
              disabled={!notificationsEnabled}
              onChange={(on) => {
                saveDailySummaryEnabled(on);
                setSummaryEnabled(on);
              }}
            />
          </Row>
        }
      </Group>
    </>
  );
}
function NotificationsBlocked() {
  useLocale();
  return (
    <span className="flex items-center gap-2 text-[12px] text-content/45">
      {t("Permission needed")}
      {IS_MAC || IS_WIN ? (
        <button
          type="button"
          onClick={() => {
            void openNotificationSettings().catch(() => {});
          }}
          className="rounded-md border border-content/10 px-2 py-1 text-content/70 hover:bg-content/10 hover:text-content"
        >
          {t("Open System Settings")}
        </button>
      ) : null}
    </span>
  );
}
