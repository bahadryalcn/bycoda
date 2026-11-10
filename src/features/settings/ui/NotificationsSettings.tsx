import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useCallback, useEffect, useRef, useState } from "react";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
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
import { RefreshCw } from "../../../shared/ui/icons";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Button } from "../../../shared/ui/Button";
import { loadSoundsEnabled, saveSoundsEnabled, subscribeSoundsEnabled } from "../model/sounds";
import { DateTimeField } from "../../../shared/ui/DateTimePicker";
import { Group, Row, Toggle, SettingsFeedback } from "./settingsControls";
import "./NotificationsSettings.css";

/**
 * Delivery time as a typed 24-hour field: any valid minute is allowed (the stored value is not
 * limited to the former hourly list). Half-typed text stays a local draft; only a complete time
 * is saved, and a failed save keeps the typed value beside its Retry.
 */
function DailySummaryTime({
  saved,
  disabled,
  onCommit,
}: {
  saved: string;
  disabled: boolean;
  onCommit: (time: string) => void;
}) {
  const [draft, setDraft] = useState({ source: saved, text: saved });
  if (draft.source !== saved) setDraft({ source: saved, text: saved });
  return (
    <DateTimeField
      mode="time"
      label={t("Daily summary time")}
      hideLabel
      description=""
      fieldVariant="compact"
      value={draft.text}
      disabled={disabled}
      onChange={(time) => {
        setDraft({ source: saved, text: time });
        if (time && time !== saved) onCommit(time);
      }}
    />
  );
}

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
      const permission = await (request
        ? requestNotificationPermission()
        : probeNotificationPermission());
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
  const commitPreference = (
    id: string,
    write: () => boolean | void,
    update: () => void,
  ): boolean => {
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
  const saveFeedback = (id: string) =>
    failedSaves[id] ? (
      <SettingsFeedback
        state="error"
        action={<Button onClick={failedSaves[id]}>{t("Retry")}</Button>}
      >
        {t("Could not save changes")}
      </SettingsFeedback>
    ) : undefined;
  const onSoundsEnabled = (next: boolean) => {
    commitPreference(
      "sounds",
      () => saveSoundsEnabled(next),
      () => setSoundsEnabled(next),
    );
  };
  const onNotificationsEnabled = (next: boolean) => {
    if (permissionInFlight.current) return;
    commitPreference(
      "notifications",
      () => saveNotificationsEnabled(next),
      () => {
        setNotificationsEnabled(next);
        if (next) void checkPermission(true);
      },
    );
  };
  const permissionText = permissionError
    ? t("Status unavailable")
    : permissionPending === "request"
      ? t("Waiting for approval…")
      : permissionPending
        ? t("Loading…")
        : notificationPermission === "granted"
          ? t("Allowed by system")
          : notificationPermission === "unsupported"
            ? t("Not available on this platform")
            : notificationPermission === "prompt"
              ? t("System permission not granted")
              : t("Status unavailable");
  const permissionStatus = (
    <div className="notification-permission-message" role={permissionError ? "alert" : "status"}>
      <div
        className={notificationPermission === "denied" ? "text-(--ui-tone-warning-fg)" : undefined}
      >
        {!permissionError && !permissionPending && notificationPermission === "denied" ? (
          <NotificationsBlocked />
        ) : (
          permissionText
        )}
      </div>
      <Button
        variant="ghost"
        iconOnly
        label={t("Refresh permission status")}
        loading={permissionPending === "probe"}
        disabled={permissionPending !== null}
        onClick={() => void checkPermission()}
      >
        <RefreshCw aria-hidden className="icon-sm" />
      </Button>
      {notificationsEnabled && notificationPermission === "prompt" ? (
        <Button
          loading={permissionPending === "request"}
          disabled={permissionPending !== null}
          onClick={() => void checkPermission(true)}
        >
          {t("Request permission")}
        </Button>
      ) : null}
    </div>
  );
  return (
    <div className="notification-alert-settings settings-topics">
      <Group title={t("Application alerts")} persistence={{ mode: "automatic" }}>
        <Row id="sounds" label={t("Sounds")} feedback={saveFeedback("sounds")}>
          <Toggle label={t("Sounds")} on={soundsEnabled} onChange={onSoundsEnabled} />
        </Row>
        <Row
          id="notifications"
          label={t("Desktop notifications")}
          descriptionVisible={false}
          description={t("Show alerts from other sessions or while {p0} is in the background.", {
            p0: PRODUCT_IDENTITY.displayName,
          })}
          scope={permissionStatus}
          feedback={saveFeedback("notifications")}
        >
          <Toggle
            label={t("Desktop notifications")}
            on={notificationsEnabled}
            onChange={onNotificationsEnabled}
            disabled={permissionPending !== null}
          />
        </Row>
        {NOTIFICATION_EVENT_SETTINGS.map((event) => (
          <Row
            key={event.id}
            id={`notification-event-${event.id}`}
            label={event.label}
            dependsOn={notificationsEnabled}
            disabledReason={t("Enable Desktop notifications first")}
            feedback={saveFeedback(event.id)}
            disabled={event.id === "taskbar" && !IS_WIN}
            info={
              event.id === "taskbar" && !IS_WIN ? (
                <InfoPopover>
                  {t(
                    "Taskbar badges and flashing are available only on Windows. Your choice is preserved.",
                  )}
                </InfoPopover>
              ) : undefined
            }
          >
            <Toggle
              label={event.label}
              on={notificationEvents[event.id]}
              disabled={!notificationsEnabled || (event.id === "taskbar" && !IS_WIN)}
              onChange={(on) => {
                commitPreference(
                  event.id,
                  () => saveNotificationEvent(event.id, on),
                  () => setNotificationEvents(loadNotificationEvents()),
                );
              }}
            />
          </Row>
        ))}
        <Row
          id="daily-summary"
          label={t("Daily summary")}
          dependsOn={notificationsEnabled}
          disabledReason={t("Enable Desktop notifications first")}
          info={
            <InfoPopover>
              {t(
                "One daily notification summarizes background tasks and goals across machines. The time uses this computer’s local clock; if the app opens later, the summary is delivered then. Click it to open the summary.",
              )}
            </InfoPopover>
          }
          feedback={saveFeedback("summary-enabled")}
        >
          <Toggle
            label={t("Daily summary")}
            on={summaryEnabled}
            disabled={!notificationsEnabled}
            onChange={(on) => {
              commitPreference(
                "summary-enabled",
                () => saveDailySummaryEnabled(on),
                () => setSummaryEnabled(on),
              );
            }}
          />
        </Row>
        {/* No row id: search indexes the delivery time under the "daily-summary" entry above. */}
        <Row
          label={t("Delivery time")}
          description={t("Uses this computer’s local clock.")}
          dependsOn={notificationsEnabled && summaryEnabled}
          disabledReason={t("Enable Daily summary first")}
          feedback={saveFeedback("summary-time")}
        >
          <DailySummaryTime
            saved={summaryTime}
            disabled={!notificationsEnabled || !summaryEnabled}
            onCommit={(time) => {
              commitPreference(
                "summary-time",
                () => saveDailySummaryTime(time),
                () => setSummaryTime(time),
              );
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
