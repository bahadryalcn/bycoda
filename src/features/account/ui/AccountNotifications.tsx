import { Text } from "../../../shared/ui/Text";
import type {
  NotificationChannel,
  NotificationEventKey,
  NotificationSettings,
} from "@bycoda/account-contracts";
import { t, useLocale } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Switch } from "../../../shared/ui/Switch";
import { TimePicker } from "../../../shared/ui/TimePicker";
import { localTimeZone, useNotificationSettings } from "../hooks/useAccountData";
import {
  NOTIFICATION_CHANNELS,
  defaultQuietHours,
  isChannelApplicable,
  isChannelOn,
  isLocked,
  setChannel,
  setDailySummaryTime,
  setPushDetails,
  setQuietHours,
  userNotificationEvents,
} from "../model/notificationSettingsModel";
import styles from "./account.module.css";
import layout from "./accountNotifications.module.css";

function channelLabel(channel: NotificationChannel): string {
  switch (channel) {
    case "in_app":
      return t("In app");
    case "os":
      return t("Desktop");
    case "push":
      return t("Phone");
    case "email":
      return t("Email");
  }
}

function eventLabel(event: NotificationEventKey): string {
  switch (event) {
    case "account.new_device_sign_in":
      return t("Sign-in from a new device");
    case "agent.finished":
      return t("Agent finished");
    case "agent.failed":
      return t("Agent failed");
    case "approval.pending":
      return t("Waiting for your approval");
    case "summary.daily":
      return t("Daily summary");
    case "announcement.published":
      return t("Announcements");
    case "account.deletion_scheduled":
      return t("Account deletion scheduled");
    case "account.phone_connect_approved":
      return t("Phone connected to a computer");
  }
}

type ChangeHandler = (change: (current: NotificationSettings) => NotificationSettings) => void;

function QuietHoursControls({
  settings,
  onChange,
}: {
  settings: NotificationSettings;
  onChange: ChangeHandler;
}) {
  const quiet = settings.quietHours;
  const zone = quiet?.timeZone ?? localTimeZone();
  return (
    <div className={layout.setting}>
      <Switch
        label={t("Quiet hours")}
        description={t("Hold non-urgent notifications during these hours.")}
        checked={quiet !== null}
        onCheckedChange={(on) =>
          onChange((s) => setQuietHours(s, on ? defaultQuietHours(zone) : null))
        }
      />
      {quiet ? (
        <div className={layout.times}>
          <TimePicker
            label={t("From")}
            value={quiet.start}
            onChange={(value) =>
              value && onChange((s) => setQuietHours(s, { ...quiet, start: value }))
            }
          />
          <TimePicker
            label={t("Until")}
            value={quiet.end}
            onChange={(value) =>
              value && onChange((s) => setQuietHours(s, { ...quiet, end: value }))
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function DailySummaryControls({
  settings,
  onChange,
}: {
  settings: NotificationSettings;
  onChange: ChangeHandler;
}) {
  if (!settings.emailDigest) return null;
  return (
    <div className={layout.setting}>
      <Text size="secondary" tone="secondary">
        {t("One e-mail a day with your activity, sent at the time you choose.")}
      </Text>
      <TimePicker
        className={layout.time}
        label={t("Send at")}
        value={settings.dailySummaryTime ?? ""}
        onChange={(value) => onChange((s) => setDailySummaryTime(s, value))}
      />
    </div>
  );
}

function EventRow({
  event,
  settings,
  onChange,
}: {
  event: NotificationEventKey;
  settings: NotificationSettings;
  onChange: ChangeHandler;
}) {
  const locked = isLocked(event);
  return (
    <>
      <Text size="secondary" tone="primary">
        {eventLabel(event)}
      </Text>
      {NOTIFICATION_CHANNELS.map((channel) =>
        isChannelApplicable(event, channel) ? (
          <span key={channel} className={styles.cell}>
            <Switch
              aria-label={`${eventLabel(event)}: ${channelLabel(channel)}`}
              checked={isChannelOn(settings, event, channel)}
              disabled={locked}
              onCheckedChange={(on) => onChange((s) => setChannel(s, event, channel, on))}
            />
          </span>
        ) : (
          <span key={channel} className={styles.cell} />
        ),
      )}
    </>
  );
}

/** Event by channel switches, quiet hours and the push-details choice. */
export function AccountNotifications() {
  useLocale();
  const { query, save } = useNotificationSettings();
  const settings = query.data;
  const update: ChangeHandler = (change) => save.mutate(change);
  return (
    <section className={styles.section} aria-labelledby="account-notifications">
      <SectionLabel labelId="account-notifications">{t("Notifications")}</SectionLabel>
      {query.isPending ? <LoadingText>{t("Loading notification settings…")}</LoadingText> : null}
      {query.isError ? (
        <InlineError retry={{ onRetry: () => query.refetch(), pending: query.isFetching }}>
          {t("Could not load your notification settings.")}
        </InlineError>
      ) : null}
      {settings ? (
        <>
          <div className={layout.matrixScroll}>
            <div
              className={layout.matrix}
              role="group"
              aria-label={t("Notifications by event and channel")}
            >
              <Text size="caption" tone="secondary" leading="inherit" className={styles.gridHead}>
                {t("Event")}
              </Text>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <Text
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  key={channel}
                  className={styles.gridHead}
                >
                  {channelLabel(channel)}
                </Text>
              ))}
              {userNotificationEvents().map((event) => (
                <EventRow key={event.key} event={event.key} settings={settings} onChange={update} />
              ))}
            </div>
          </div>
          <Text as="p" size="caption" tone="secondary" leading="inherit">
            {t("Sign-ins from a new device always notify you, so they cannot be switched off.")}
          </Text>
          <DailySummaryControls settings={settings} onChange={update} />
          <QuietHoursControls settings={settings} onChange={update} />
          <Switch
            label={t("Show details in phone notifications")}
            description={t(
              "Off by default: phone notifications then say only that something needs you, without project or session names.",
            )}
            checked={settings.pushShowDetails}
            onCheckedChange={(on) => update((s) => setPushDetails(s, on))}
          />
          {save.isPending ? <LoadingText delay={false}>{t("Saving…")}</LoadingText> : null}
          {save.isError ? (
            <InlineError>{t("Could not save. Your previous choice was kept.")}</InlineError>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
