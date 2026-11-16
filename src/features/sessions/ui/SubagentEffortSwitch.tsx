import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { subagentEffortCeiling } from "../../../shared/model/host-contracts/delegation";
import { Switch } from "../../../shared/ui/Switch";

/**
 * Automatic removes the ceiling, not reasoning. Remember manual choice while mounted.
 * `levels` are the offered ceilings; switching Automatic off starts on Low when offered.
 */
export function SubagentEffortSwitch({
  value,
  levels,
  disabled,
  onChange,
}: {
  value: string;
  levels?: readonly string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const ceiling = subagentEffortCeiling(value);
  const first = !levels?.length || levels.includes("low") ? "low" : levels[0];
  const [manual, setManual] = useState(ceiling || first);
  return (
    <Switch
      label={t("Automatic")}
      labelPosition="start"
      checked={!ceiling}
      disabled={disabled}
      onCheckedChange={(automatic) => {
        if (automatic) setManual(ceiling || manual);
        onChange(automatic ? "" : manual);
      }}
    />
  );
}
