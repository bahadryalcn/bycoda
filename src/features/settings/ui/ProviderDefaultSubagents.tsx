import { useState } from "react";
import { t } from "../../../shared/i18n";
import {
  AUTOMATIC_SUBAGENTS,
  decodeAdvisor,
  decodeSubagentSelection,
  encodeAdvisor,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import {
  DelegationOptionIcon,
  delegationSelectChoice,
} from "../../sessions/public/modelPickerData";
import type { ModelSetting } from "../../sessions/public/models";

/** Provider-default draft using the conversation panel's subagent wire values. */
export function ProviderDefaultSubagents({
  setting,
  value,
  onChange,
}: {
  setting: ModelSetting;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const [picking, setPicking] = useState<{ value: string | undefined } | null>(null);
  const selection = decodeSubagentSelection(value ?? AUTOMATIC_SUBAGENTS);
  const selected = selection === AUTOMATIC_SUBAGENTS ? [] : selection;
  const mode =
    picking && picking.value === value
      ? "custom"
      : selection === AUTOMATIC_SUBAGENTS
        ? "auto"
        : selected.length
          ? "custom"
          : "off";
  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <SegmentedControl
        label={t(setting.label)}
        value={mode}
        options={[
          { value: "auto", label: t("Automatic") },
          { value: "custom", label: t("Custom") },
          { value: "off", label: t("Off") },
        ]}
        onValueChange={(next) => {
          setPicking(next === "custom" ? { value } : null);
          // Custom is a picker action; persist only when a model is chosen.
          if (next !== "custom") onChange(next === "auto" ? AUTOMATIC_SUBAGENTS : "[]");
        }}
      />
      {mode === "custom" ? (
        <SearchableSelect
          multiple
          label={t(setting.label)}
          hideLabel
          placeholder={t("Add")}
          value={selected.map((ref) => encodeAdvisor(ref)!)}
          options={setting.options
            .filter((option) => decodeAdvisor(option.value))
            .map((option) => ({
              value: option.value,
              ...delegationSelectChoice(setting, option, t),
              icon: <DelegationOptionIcon setting={setting} value={option.value} />,
              disabled: "disabled" in option && option.disabled === true,
            }))}
          onChange={(next) => {
            setPicking(null);
            onChange(
              encodeSubagents(
                next.flatMap((value) => {
                  const ref = decodeAdvisor(value);
                  return ref ? [ref] : [];
                }),
              ) ?? "[]",
            );
          }}
        />
      ) : null}
    </div>
  );
}
