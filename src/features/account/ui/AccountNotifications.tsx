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
import { TextField } from "../../../shared/ui/TextField";
import { localTimeZone, useNotificationSettings } from "../hooks/useAccountData";
import {
  NOTIFICATION_CHANNELS,
  defaultQuietHours,
  isChannelApplicable,
  isChannelOn,
  isLocked,
  setChannel,
  setDailySummaryTime,
  setEmailDigest,
  setPushDetails,
  setQuietHours,
  userNotificationEvents,
} from "../model/notificationSettingsModel";
import styles from "./account.module.css";

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
  }
}

type ChangeHandler = (next: NotificationSettings) => void;

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
    <div className={styles.quiet}>
      <Switch
        label={t("Quiet hours")}
        description={t("Hold non-urgent notifications during these hours.")}
        checked={quiet !== null}
        onCheckedChange={(on) =>
          onChange(setQuietHours(settings, on ? defaultQuietHours(zone) : null))
        }
      />
      {quiet ? (
        <>
          <TextField
            label={t("From")}
            type="time"
            value={quiet.start}
            onChange={(event) =>
              event.target.value &&
              onChange(setQuietHours(settings, { ...quiet, start: event.target.value }))
            }
          />
          <TextField
            label={t("Until")}
            type="time"
            value={quiet.end}
            onChange={(event) =>
              event.target.value &&
              onChange(setQuietHours(settings, { ...quiet, end: event.target.value }))
            }
          />
        </>
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
  return (
    <div className={styles.quiet}>
      <Switch
        label={t("E-mail me a daily summary")}
        description={t("One e-mail a day with your activity, sent at the time you choose.")}
        checked={settings.emailDigest}
        onCheckedChange={(on) => onChange(setEmailDigest(settings, on))}
      />
      {settings.emailDigest ? (
        <TextField
          label={t("Send at")}
          type="time"
          value={settings.dailySummaryTime ?? ""}
          onChange={(event) => onChange(setDailySummaryTime(settings, event.target.value))}
        />
      ) : null}
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
      <span>{eventLabel(event)}</span>
      {NOTIFICATION_CHANNELS.map((channel) =>
        isChannelApplicable(event, channel) ? (
          <span key={channel} className={styles.cell}>
            <Switch
              aria-label={`${eventLabel(event)}: ${channelLabel(channel)}`}
              checked={isChannelOn(settings, event, channel)}
              disabled={locked}
              onCheckedChange={(on) => onChange(setChannel(settings, event, channel, on))}
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
  const update: ChangeHandler = (next) => save.mutate(next);
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
          <div
            className={styles.grid}
            role="group"
            aria-label={t("Notifications by event and channel")}
          >
            <span className={styles.gridHead}>{t("Event")}</span>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <span key={channel} className={styles.gridHead}>
                {channelLabel(channel)}
              </span>
            ))}
            {userNotificationEvents().map((event) => (
              <EventRow key={event.key} event={event.key} settings={settings} onChange={update} />
            ))}
          </div>
          <DailySummaryControls settings={settings} onChange={update} />
          <p className={styles.meta}>
            {t("Sign-ins from a new device always notify you, so they cannot be switched off.")}
          </p>
          <QuietHoursControls settings={settings} onChange={update} />
          <Switch
            label={t("Show details in phone notifications")}
            description={t(
              "Off by default: phone notifications then say only that something needs you, without project or session names.",
            )}
            checked={settings.pushShowDetails}
            onCheckedChange={(on) => update(setPushDetails(settings, on))}
          />
          {save.isError ? (
            <InlineError>{t("Could not save. Your previous choice was kept.")}</InlineError>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
