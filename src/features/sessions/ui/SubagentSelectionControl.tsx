import { useState } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import {
  AUTOMATIC_SUBAGENTS,
  decodeAdvisor,
  decodeSubagentSelection,
  encodeAdvisor,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SubagentModeControl } from "./SubagentModeControl";
import { DelegationOptionIcon, delegationSelectChoice } from "./DelegationSettings";
import type { ModelSetting } from "../model/models";

/** Subagent mode (Automatic, Custom, Off) with the custom model list, in the conversation panel's wire values. */
export function SubagentSelectionControl({
  setting,
  value,
  onChange,
  compact = false,
}: {
  setting: ModelSetting;
  value: string | undefined;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const t = useT();
  const { formatNumber } = useFormat();
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
          selectionLabels={
            compact
              ? {
                  summary: (count) => t("{p0} selected", { p0: formatNumber(count) }),
                }
              : undefined
          }
          value={selected.map((ref) => encodeAdvisor(ref)!)}
          options={setting.options
            .filter(
              (option, index, all) =>
                decodeAdvisor(option.value) &&
                all.findIndex((other) => other.value === option.value) === index,
            )
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
