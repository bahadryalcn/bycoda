import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useEffect, useState } from "react";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  DAILY_SUMMARY_TIMES,
  loadDailySummaryEnabled,
  subscribeDailySummary,
  loadDailySummaryTime,
  saveDailySummaryEnabled,
  saveDailySummaryTime,
} from "../../notifications/model/dailySummarySettings";
import {
  NOTIFICATION_EVENT_SETTINGS,
  loadNotificationEvents,
  subscribeNotificationEvents,
  saveNotificationEvent,
} from "../../notifications/model/notificationEvents";
import {
  cachedNotificationPermission,
  loadNotificationsEnabled,
  subscribeNotificationsEnabled,
  openNotificationSettings,
  probeNotificationPermission,
  requestNotificationPermission,
  saveNotificationsEnabled,
  type NotificationPermission,
} from "../../notifications/model/notifications";
import { Button } from "../../../shared/ui/Button";
import { loadSoundsEnabled, saveSoundsEnabled, subscribeSoundsEnabled } from "../model/sounds";
import { Group, Row, Select, Toggle, SettingsFeedback } from "./settingsControls";
import "./NotificationsSettings.css";

export function NotificationAlerts() {
  useLocale();
  const [soundsEnabled, setSoundsEnabled] = useStoredPreferenceState(
    loadSoundsEnabled,
    subscribeSoundsEnabled,
  );
  const [notificationsEnabled, setNotificationsEnabled] = useStoredPreferenceState(
    loadNotificationsEnabled,
    subscribeNotificationsEnabled,
  );
  const [notificationEvents, setNotificationEvents] = useStoredPreferenceState(
    loadNotificationEvents,
    subscribeNotificationEvents,
  );
  const [summaryEnabled, setSummaryEnabled] = useStoredPreferenceState(
    loadDailySummaryEnabled,
    subscribeDailySummary,
  );
  const [summaryTime, setSummaryTime] = useStoredPreferenceState(
    loadDailySummaryTime,
    subscribeDailySummary,
  );
  const [permissionPending, setPermissionPending] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    cachedNotificationPermission,
  );
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void probeNotificationPermission().then(
        (permission) => {
          if (active) {
            setNotificationPermission(permission);
            setPermissionError(false);
          }
        },
        () => {
          if (active) setPermissionError(true);
        },
      );
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
    if (permissionPending) return;
    saveNotificationsEnabled(next);
    setNotificationsEnabled(next);
    if (!next) return;
    setPermissionPending(true);
    setPermissionError(false);
    void requestNotificationPermission()
      .then(setNotificationPermission, () => setPermissionError(true))
      .finally(() => setPermissionPending(false));
  };
  return (
    <div className="notification-alert-settings">
      <Group
        title={t("Application alerts")}
        layout="full"
        persistence={{ mode: "automatic" }}
        description={t("Delivery preferences for all projects on this computer.")}
      >
        <Row
          id="sounds"
          label={t("Sounds")}
          description={t("Play short sounds for project activity and updates.")}
        >
          <Toggle label={t("Sounds")} on={soundsEnabled} onChange={onSoundsEnabled} />
        </Row>
        <Row
          id="notifications"
          label={t("Desktop notifications")}
          description={t("Show alerts from other sessions or while {p0} is in the background.", {
            p0: PRODUCT_IDENTITY.displayName,
          })}
        >
          <Toggle
            label={t("Desktop notifications")}
            on={notificationsEnabled}
            onChange={onNotificationsEnabled}
            disabled={permissionPending}
          />
        </Row>
        <div className="notification-permission-status">
          {!permissionError && !permissionPending && notificationPermission === "granted" ? (
            <p>{t("System permission granted")}</p>
          ) : (
            <SettingsFeedback
              state={
                permissionError
                  ? "error"
                  : permissionPending
                    ? "loading"
                    : notificationPermission === "granted"
                      ? "success"
                      : "warning"
              }
            >
              {permissionError ? (
                t("Status unavailable")
              ) : permissionPending ? (
                t("Waiting for approval…")
              ) : (
                <>
                  {notificationPermission === "denied" ? <NotificationsBlocked /> : null}
                  {notificationPermission === "unsupported"
                    ? t("Not available on this platform")
                    : null}
                  {notificationPermission === "prompt"
                    ? t(
                        "System permission has not been granted yet. Enabling notifications requests permission.",
                      )
                    : null}
                </>
              )}
            </SettingsFeedback>
          )}
        </div>
      </Group>
      <Group
        title={t("Desktop alert events")}
        layout="full"
        description={t(
          "Choose which agent events reach your desktop. Click an alert to open its session.",
        )}
        dependency={
          !notificationsEnabled
            ? t("Enable Notifications to deliver these alerts. Your choices are preserved.")
            : notificationPermission === "denied" || notificationPermission === "unsupported"
              ? t(
                  "You can choose events now, but desktop delivery requires system notification access.",
                )
              : undefined
        }
      >
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
      <Group title={t("Daily summary")} layout="full">
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
          description={t("A daily overview of background tasks and goals across machines.")}
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
        <section className="notification-summary-help">
          <h3>{t("Schedule details")}</h3>
          <p>
            {t(
              "One daily notification summarizes background tasks and goals across machines. The time uses this computer’s local clock; if the app opens later, the summary is delivered then. Click it to open the summary.",
            )}
          </p>
        </section>
      </Group>
    </div>
  );
}
function NotificationsBlocked() {
  useLocale();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const openSettings = async () => {
    if (opening) return;
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
    <div className="notification-permission-message">
      {t("Notifications are blocked by system permission.")}
      {IS_MAC || IS_WIN ? (
        <Button className="shrink-0" onClick={() => void openSettings()} loading={opening}>
          {t("Open System Settings")}
        </Button>
      ) : (
        <span>{t("Allow notifications in your system settings to receive desktop alerts.")}</span>
      )}
      {error ? (
        <SettingsFeedback state="error">
          {t(
            "Could not open system settings. Open notification permissions from your system settings.",
          )}
        </SettingsFeedback>
      ) : null}
    </div>
  );
}
