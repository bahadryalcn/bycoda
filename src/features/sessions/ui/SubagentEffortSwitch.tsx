import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { subagentEffortCeiling } from "../../../shared/model/host-contracts/delegation";
import { Switch } from "../../../shared/ui/Switch";

/** Automatic removes the ceiling, not reasoning. Remember manual choice while mounted. */
export function SubagentEffortSwitch({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const ceiling = subagentEffortCeiling(value);
  const [manual, setManual] = useState(ceiling || "low");
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
