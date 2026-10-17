import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import {
  DateTimePicker,
  parseLocalDateTime,
  toLocalDateTime,
} from "../../../shared/ui/DateTimePicker";

type Props = {
  projectIds: readonly string[];
  onChanged?: () => void;
  onCancel: () => void;
};

/** Custom timing is a complete step, separate from the duration presets. */
export function NotificationMuteDatePicker({ projectIds, onChanged, onCancel }: Props) {
  useLocale();
  const [value, setValue] = useState(() => {
    const until =
      projectIds.length === 1
        ? loadNotificationPreferences()[projectIds[0]]?.mutedUntil
        : undefined;
    const initial =
      typeof until === "number" && until > Date.now() ? until : Date.now() + 3_600_000;
    return toLocalDateTime(new Date(Math.ceil(initial / 60_000) * 60_000));
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        if (!projectIds.length) return;
        const date = parseLocalDateTime(value);
        if (!date) {
          setError("Choose a valid date and time.");
          return;
        }
        if (date.getTime() <= Date.now()) {
          setError("Choose a date and time in the future.");
          return;
        }
        try {
          updateNotificationPreferences(projectIds, {
            mutedUntil: date.getTime(),
          });
          setError(null);
          onChanged?.();
        } catch {
          setError("Could not save notification preferences. Please try again.");
        }
      }}
    >
      <p className="mb-3 px-1 text-[11px] text-content/45">{t("Mute all notifications until")}</p>
      <DateTimePicker
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
        minDate={toLocalDateTime(new Date(Date.now())).slice(0, 10)}
        autoFocus
      />
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-stroke pt-2.5">
        <Button type="button" onClick={onCancel} aria-label={t("Cancel")} variant="ghost">
          {t("Cancel")}
        </Button>
        <Button
          type="submit"
          aria-label={t("Mute until then")}
          disabled={!projectIds.length}
          variant="primary"
        >
          {t("Mute until then")}
        </Button>
      </div>
    </form>
  );
}
