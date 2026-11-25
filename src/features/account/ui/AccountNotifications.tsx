import type {
  NotificationChannel,
  NotificationEventKey,
  NotificationSettings,
} from "@bycoda/account-contracts";
import { t, useLocale } from "../../../shared/i18n";
import { Group, Row, SettingsFeedback, Toggle } from "../../../shared/ui/settings";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TimePicker } from "../../../shared/ui/TimePicker";
import { localTimeZone, useNotificationSettings } from "../hooks/useAccountData";
import { useAccountState } from "../hooks/useAccount";
import { isDeactivated } from "./AccountStatus";
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

function QuietHoursRow({
  settings,
  onChange,
}: {
  settings: NotificationSettings;
  onChange: ChangeHandler;
}) {
  const quiet = settings.quietHours;
  const zone = quiet?.timeZone ?? localTimeZone();
  return (
    <Row
      label={t("Quiet hours")}
      description={t("Hold non-urgent notifications during these hours.")}
    >
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
      <Toggle
        label={t("Quiet hours")}
        on={quiet !== null}
        onChange={(on) => onChange((s) => setQuietHours(s, on ? defaultQuietHours(zone) : null))}
      />
    </Row>
  );
}

function DailySummaryRow({
  settings,
  onChange,
}: {
  settings: NotificationSettings;
  onChange: ChangeHandler;
}) {
  if (!settings.emailDigest) return null;
  return (
    <Row
      label={t("Daily summary")}
      description={t("One e-mail a day with your activity, sent at the time you choose.")}
    >
      <TimePicker
        className={layout.time}
        label={t("Send at")}
        hideLabel
        value={settings.dailySummaryTime ?? ""}
        onChange={(value) => onChange((s) => setDailySummaryTime(s, value))}
      />
    </Row>
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
    <Row label={eventLabel(event)}>
      <div className={layout.channels} role="group" aria-label={eventLabel(event)}>
        {NOTIFICATION_CHANNELS.filter((channel) => isChannelApplicable(event, channel)).map(
          (channel) => (
            <Checkbox
              key={channel}
              label={channelLabel(channel)}
              checked={isChannelOn(settings, event, channel)}
              disabled={locked}
              disabledReason={locked ? t("This notification cannot be turned off.") : undefined}
              onChange={(next) => {
                const on = next.currentTarget.checked;
                onChange((s) => setChannel(s, event, channel, on));
              }}
            />
          ),
        )}
      </div>
    </Row>
  );
}

/** One row per event with its channels, then quiet hours and the push-details choice. */
export function AccountNotifications() {
  useLocale();
  const { query, save } = useNotificationSettings();
  const settings = query.data;
  const update: ChangeHandler = (change) => save.mutate(change);
  return (
    <Group
      title={t("Notifications")}
      description={t(
        "Sign-ins from a new device always notify you, so they cannot be switched off.",
      )}
      feedback={
        query.isPending ? (
          <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
        ) : query.isError ? (
          <SettingsFeedback
            state="error"
            action={{ label: t("Retry"), onClick: () => query.refetch() }}
          >
            {t("Could not load your notification settings.")}
          </SettingsFeedback>
        ) : save.isError ? (
          <SettingsFeedback state="error">
            {t("Could not save. Your previous choice was kept.")}
          </SettingsFeedback>
        ) : undefined
      }
    >
      {settings ? (
        <>
          {userNotificationEvents().map((event) => (
            <EventRow key={event.key} event={event.key} settings={settings} onChange={update} />
          ))}
          <DailySummaryRow settings={settings} onChange={update} />
          <QuietHoursRow settings={settings} onChange={update} />
          <Row
            label={t("Show details in phone notifications")}
            description={t(
              "Off by default: phone notifications then say only that something needs you, without project or session names.",
            )}
          >
            <Toggle
              label={t("Show details in phone notifications")}
              on={settings.pushShowDetails}
              onChange={(on) => update((s) => setPushDetails(s, on))}
            />
          </Row>
        </>
      ) : null}
    </Group>
  );
}

/** Account delivery is available only to users who can update their account preferences. */
export function SignedInAccountNotifications() {
  const account = useAccountState();
  return account.phase === "signed-in" && !isDeactivated(account.context.user) ? (
    <AccountNotifications />
  ) : null;
}
