import { useT } from "../../../shared/i18n";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { subagentMode, subagentModeValue } from "../model/crossDelegation";

/** Selects a subagent mode; custom opens the caller's model picker. */
export function SubagentModeControl({
  label,
  value,
  disabled,
  picking,
  onChange,
  onCustom,
}: {
  label: string;
  value: string | undefined;
  disabled?: boolean;
  picking?: boolean;
  onChange: (value: string) => void;
  onCustom: () => void;
}) {
  const t = useT();
  return (
    <SegmentedControl
      label={label}
      value={picking ? "custom" : subagentMode(value)}
      options={[
        { value: "auto", label: t("Automatic"), disabled },
        { value: "custom", label: t("Custom"), disabled },
        { value: "off", label: t("Off"), disabled },
      ]}
      onValueChange={(next) =>
        next === "custom" ? onCustom() : onChange(subagentModeValue(next as "auto" | "off"))
      }
    />
  );
}
