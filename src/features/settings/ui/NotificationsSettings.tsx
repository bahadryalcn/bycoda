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
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { loadSoundsEnabled, saveSoundsEnabled } from "../model/sounds";
import { Group, Row, Select, Toggle } from "./settingsControls";
import "./NotificationsSettings.css";

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
    let active = true;
    const refresh = () => {
      void probeNotificationPermission().then((permission) => {
        if (active) setNotificationPermission(permission);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
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
    <div className="notification-alert-settings">
      <Group
        title={t("Application alerts")}
        layout="full"
        scope={t(
          "Applies across projects on this computer. Project categories and mute settings below further control project alerts.",
        )}
        persistence={{ mode: "automatic" }}
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
          <Toggle
            label={t("Notifications")}
            on={notificationsEnabled}
            onChange={onNotificationsEnabled}
          />
        </Row>
        <div className="notification-permission-status" role="status">
          {notificationPermission === "denied" ? <NotificationsBlocked /> : null}
          {notificationPermission === "unsupported" ? t("Not available on this platform") : null}
          {notificationPermission === "granted" ? t("System permission granted") : null}
          {notificationPermission === "prompt"
            ? t(
                "System permission has not been granted yet. Enabling notifications requests permission.",
              )
            : null}
          {!notificationsEnabled ? (
            <p>{t("Enable Notifications to deliver these alerts. Your choices are preserved.")}</p>
          ) : null}
        </div>
        {NOTIFICATION_EVENT_SETTINGS.map((event) => (
          <Row
            key={event.id}
            id={`notification-event-${event.id}`}
            label={event.label}
            description={event.description}
            dependency={
              event.id === "taskbar" && !IS_WIN
                ? t(
                    "Taskbar badges and flashing are available only on Windows. Your choice is preserved.",
                  )
                : notificationsEnabled &&
                    event.id !== "taskbar" &&
                    (notificationPermission === "denied" ||
                      notificationPermission === "unsupported")
                  ? t(
                      "You can choose events now, but desktop delivery requires system notification access.",
                    )
                  : undefined
            }
          >
            <Toggle
              label={event.label}
              on={notificationEvents[event.id]}
              disabled={!notificationsEnabled || (event.id === "taskbar" && !IS_WIN)}
              onChange={(on) => {
                saveNotificationEvent(event.id, on);
                setNotificationEvents(loadNotificationEvents());
              }}
            />
          </Row>
        ))}
      </Group>
      <Group title={t("Daily summary")} layout="full" persistence={{ mode: "automatic" }}>
        <Row
          dependency={
            !notificationsEnabled
              ? t("Enable Notifications to deliver the daily summary. Your schedule is preserved.")
              : notificationPermission === "denied" || notificationPermission === "unsupported"
                ? t(
                    "The summary schedule is saved, but desktop delivery requires system notification access.",
                  )
                : undefined
          }
          id="daily-summary"
          label={t("Daily summary")}
          description={t(
            "One daily notification summarizes background tasks and goals across machines. The time uses this computer’s local clock; if the app opens later, the summary is delivered then. Click it to open the summary.",
          )}
        >
          {
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
              disabled={!notificationsEnabled || !summaryEnabled}
            />
          }
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
      </Group>
    </div>
  );
}
function NotificationsBlocked() {
  useLocale();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const openSettings = async () => {
    setOpening(true);
    setError(false);
    try {
      await openNotificationSettings();
    } catch {
      setError(true);
    } finally {
      setOpening(false);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2 text-[12px] text-content/60">
      {t("Notifications are blocked by system permission.")}
      {IS_MAC || IS_WIN ? (
        <SecondaryButton onClick={() => void openSettings()} disabled={opening}>
          {opening ? t("Opening…") : t("Open System Settings")}
        </SecondaryButton>
      ) : (
        <span>{t("Allow notifications in your system settings to receive desktop alerts.")}</span>
      )}
      {error ? (
        <span role="alert" className="text-danger">
          {t(
            "Could not open system settings. Open notification permissions from your system settings.",
          )}
        </span>
      ) : null}
    </span>
  );
}
