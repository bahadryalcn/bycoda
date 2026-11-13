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
import { SubagentModeControl } from "../../sessions/public/SubagentModeControl";
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
  const pickingCustom = !!picking && picking.value === value;
  const custom = pickingCustom || (selection !== AUTOMATIC_SUBAGENTS && selected.length > 0);
  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <SubagentModeControl
        label={t(setting.label)}
        value={value}
        picking={pickingCustom}
        onCustom={() => setPicking({ value })}
        onChange={(next) => {
          setPicking(null);
          onChange(next);
        }}
      />
      {custom ? (
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
