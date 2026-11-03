import { SplitButton } from "../../../shared/ui/SplitButton";
import { t } from "../../../shared/i18n";

/** The primary action never submits audio while switching into manual mode. */
export function VoiceTurnControl({
  manual,
  muted,
  compact,
  onManualChange,
  onFinish,
}: {
  manual: boolean;
  muted: boolean;
  compact?: boolean;
  onManualChange: (manual: boolean) => void;
  onFinish: () => void;
}) {
  return (
    <SplitButton
      label={manual ? t("Finish turn") : compact ? t("Wait for me") : t("Wait until I finish")}
      menuLabel={t("Turn ending")}
      tooltip={manual ? t("Finish turn") : t("Wait until I finish")}
      disabled={manual && muted}
      menuDisabled={false}
      onClick={() => (manual ? onFinish() : onManualChange(true))}
      actions={[
        {
          id: "manual",
          label: t("Wait until I finish"),
          checked: manual,
          selectionRole: "radio",
          onSelect: () => onManualChange(true),
        },
        {
          id: "automatic",
          label: t("Automatic replies"),
          checked: !manual,
          selectionRole: "radio",
          onSelect: () => onManualChange(false),
        },
      ]}
    />
  );
}
