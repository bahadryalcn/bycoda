import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AdvancedSettings, Group, Row, Select, Toggle, SettingsFeedback } from "./settingsControls";
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
  const [permissionPending, setPermissionPending] = useState<"probe" | "request" | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const [failedSaves, setFailedSaves] = useState<Record<string, () => void>>({});
  const permissionInFlight = useRef(false);
  const active = useRef(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    cachedNotificationPermission,
  );
  const checkPermission = useCallback(async (request = false) => {
    if (permissionInFlight.current) return;
    permissionInFlight.current = true;
    setPermissionPending(request ? "request" : "probe");
    setPermissionError(false);
    try {
      const permission = await (request ? requestNotificationPermission() : probeNotificationPermission());
      if (active.current) {
        setNotificationPermission(permission);
        setPermissionError(permission === "unavailable");
      }
    } catch {
      if (active.current) setPermissionError(true);
    } finally {
      permissionInFlight.current = false;
      if (active.current) setPermissionPending(null);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const refresh = () => void checkPermission();
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active.current = false;
      window.removeEventListener("focus", refresh);
    };
  }, [checkPermission]);
  const commitPreference = (id: string, write: () => boolean | void, update: () => void): boolean => {
    try {
      if (write() === false) throw new Error("Preference was not persisted");
      update();
      setFailedSaves((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return true;
    } catch {
      setFailedSaves((current) => ({
        ...current,
        [id]: () => void commitPreference(id, write, update),
      }));
      return false;
    }
  };
  const saveFeedback = (id: string) => failedSaves[id] ? (
    <SettingsFeedback state="error" action={<Button onClick={failedSaves[id]}>{t("Retry")}</Button>}>
      {t("Could not save changes")}
    </SettingsFeedback>
  ) : undefined;
  const onSoundsEnabled = (next: boolean) => {
    commitPreference("sounds", () => saveSoundsEnabled(next), () => setSoundsEnabled(next));
  };
  const onNotificationsEnabled = (next: boolean) => {
    if (permissionInFlight.current) return;
    commitPreference("notifications", () => saveNotificationsEnabled(next), () => {
      setNotificationsEnabled(next);
      if (next) void checkPermission(true);
    });
  };
  return (
    <div className="notification-alert-settings settings-topics">
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
          feedback={saveFeedback("sounds")}
        >
          <Toggle label={t("Sounds")} on={soundsEnabled} onChange={onSoundsEnabled} />
        </Row>
        <Row
          id="notifications"
          label={t("Desktop notifications")}
          description={t("Show alerts from other sessions or while {p0} is in the background.", {
            p0: PRODUCT_IDENTITY.displayName,
          })}
          feedback={saveFeedback("notifications")}
        >
          <Toggle
            label={t("Desktop notifications")}
            on={notificationsEnabled}
            onChange={onNotificationsEnabled}
            disabled={permissionPending !== null}
          />
        </Row>
        <div className="notification-permission-status">
          {!permissionError && !permissionPending && notificationPermission === "granted" ? (
            <div className="notification-permission-message">
              <p>{t("System permission granted")}</p>
              <Button variant="ghost" onClick={() => void checkPermission()}>{t("Refresh")}</Button>
            </div>
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
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Button loading={permissionPending === "probe"} disabled={permissionPending !== null} onClick={() => void checkPermission()}>{t("Refresh")}</Button>
                  {notificationsEnabled && notificationPermission === "prompt" ? (
                    <Button loading={permissionPending === "request"} disabled={permissionPending !== null} onClick={() => void checkPermission(true)}>{t("Request permission")}</Button>
                  ) : null}
                </div>
              }
            >
              {permissionError ? (
                t("Status unavailable")
              ) : permissionPending ? (
                permissionPending === "request" ? t("Waiting for approval…") : t("Loading…")
              ) : (
                <>
                  {notificationPermission === "denied" ? <NotificationsBlocked /> : null}
                  {notificationPermission === "unsupported"
                    ? t("Not available on this platform")
                    : null}
                  {notificationPermission === "unavailable" ? t("Status unavailable") : null}
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
            feedback={saveFeedback(event.id)}
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
                commitPreference(event.id, () => saveNotificationEvent(event.id, on), () => setNotificationEvents(loadNotificationEvents()));
              }}
            />
          </Row>
        ))}
      </Group>
      <Group title={t("Daily summary")} layout="full" scope={t("Uses this computer’s local clock.")}>
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
          feedback={<>{saveFeedback("summary-enabled")}{saveFeedback("summary-time")}</>}
        >
          {
            <Select
              label={t("Daily summary time")}
              value={summaryTime}
              options={[...new Set([...DAILY_SUMMARY_TIMES, summaryTime])].sort().map((time) => ({
                value: time,
                label: time,
              }))}
              onChange={(time) => {
                commitPreference("summary-time", () => saveDailySummaryTime(time), () => setSummaryTime(time));
              }}
              disabled={!notificationsEnabled || !summaryEnabled}
            />
          }
          <Toggle
            label={t("Daily summary")}
            on={summaryEnabled}
            disabled={!notificationsEnabled}
            onChange={(on) => {
              commitPreference("summary-enabled", () => saveDailySummaryEnabled(on), () => setSummaryEnabled(on));
            }}
          />
        </Row>
        <AdvancedSettings title={t("Schedule details")} defaultOpen={false}>
          <p>
            {t(
              "One daily notification summarizes background tasks and goals across machines. The time uses this computer’s local clock; if the app opens later, the summary is delivered then. Click it to open the summary.",
            )}
          </p>
        </AdvancedSettings>
      </Group>
    </div>
  );
}
function NotificationsBlocked() {
  useLocale();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const openSettings = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    setError(false);
    try {
      await openNotificationSettings();
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
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
