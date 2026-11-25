import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import {
  DateTimePanel,
  parseLocalDateTime,
  toLocalDateTime,
} from "../../../shared/ui/DateTimePicker";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useNotificationPreferencesView } from "../hooks/useProjectNotificationPreferences";

type Props = {
  projectIds: readonly string[];
  onChanged?: () => void;
  onCancel: () => void;
};

/** Custom timing is a complete step, separate from the duration presets. */
export function NotificationMuteDatePicker({ projectIds, onChanged, onCancel }: Props) {
  const t = useT();
  const { unavailable } = useNotificationPreferencesView();
  const [value, setValue] = useState(() => {
    const until =
      projectIds.length === 1
        ? loadNotificationPreferences()[projectIds[0]]?.mutedUntil
        : undefined;
    const initial =
      typeof until === "number" && until > Date.now() ? until : Date.now() + 3_600_000;
    return toLocalDateTime(new Date(Math.ceil(initial / 60_000) * 60_000));
  });
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        if (!projectIds.length || unavailable) return;
        const date = parseLocalDateTime(value);
        if (!date) {
          setProblem(t("Choose a valid date and time."));
          return;
        }
        if (date.getTime() <= Date.now()) {
          setProblem(t("Choose a date and time in the future."));
          return;
        }
        try {
          updateNotificationPreferences(projectIds, {
            mutedUntil: date.getTime(),
          });
          setProblem(null);
          onChanged?.();
        } catch {
          setProblem(t("Could not save notification preferences. Please try again."));
        }
      }}
    >
      <Text as="p" size="micro" tone="secondary" className="mb-3 px-1">
        {t("Mute all notifications until")}
      </Text>
      <DateTimePanel
        value={value}
        onChange={(next) => {
          setValue(next);
          setProblem(null);
        }}
        minDate={toLocalDateTime(new Date(Date.now())).slice(0, 10)}
        autoFocus
      />
      {problem ? (
        <Alert tone="danger" className="mt-3">
          {problem}
        </Alert>
      ) : null}
      <div
        {...surfaceAttributes(
          { frame: "pane", edge: "top" },
          "mt-3 flex items-center justify-between gap-2 pt-2.5",
        )}
      >
        <Button type="button" onClick={onCancel} variant="ghost">
          {t("Cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!projectIds.length || unavailable}
          disabledReason={
            projectIds.length
              ? t("Saved project notification choices could not be read.")
              : t("Choose a project first.")
          }
          variant="primary"
        >
          {t("Mute until then")}
        </Button>
      </div>
    </form>
  );
}
