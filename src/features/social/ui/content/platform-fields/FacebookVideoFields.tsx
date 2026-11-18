import { t } from "../../../../../shared/i18n";
import { DateTimePicker } from "../../../../../shared/ui/DateTimePicker";
import type { PlatformFieldProps } from "./PlatformFields";

export function FacebookVideoFields({ value, disabled, onChange }: PlatformFieldProps) {
  const target = value.facebook?.target ?? "feed";
  if (target !== "feed" && target !== "video") return null;
  return (
    <DateTimePicker
      label={t("Facebook publish time")}
      hint={t("Optional. Facebook can publish 10 minutes to 75 days after dispatch.")}
      value={value.facebook?.scheduledPublishAt ?? ""}
      clearable
      disabled={disabled}
      onChange={(scheduledPublishAt) =>
        onChange({
          ...value,
          facebook: { ...value.facebook, target, scheduledPublishAt },
        })
      }
    />
  );
}
