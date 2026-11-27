import { useState } from "react";
import { useT } from "../../../shared/i18n";
import {
  AUTOMATIC_SUBAGENTS,
  DELEGATION_LIMITS,
  decodeAdvisor,
  decodeSubagentSelection,
  encodeAdvisor,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import {
  decodeImageModels,
  encodeImageModels,
} from "../../../shared/model/host-contracts/image-models";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { catalogText } from "../model/catalogText";
import { isImageModelsSetting } from "../model/crossDelegation";
import type { ModelSetting } from "../model/models";
import { DelegationChecklist, DelegationModelList } from "./DelegationModelList";

type Mode = "auto" | "custom" | "off";

/** Mode of a stored value: subagents use `auto`/`[]`/a list, image models unset/`[]`/a list. */
function delegationMode(setting: ModelSetting, value: string | undefined): Mode {
  if (isImageModelsSetting(setting)) {
    const ids = decodeImageModels(value);
    return ids === undefined ? "auto" : ids.length ? "custom" : "off";
  }
  const selection = decodeSubagentSelection(value ?? AUTOMATIC_SUBAGENTS);
  return selection === AUTOMATIC_SUBAGENTS ? "auto" : selection.length ? "custom" : "off";
}

/** The picked option values, in saved order. */
function pickedValues(setting: ModelSetting, value: string | undefined): string[] {
  if (isImageModelsSetting(setting)) return decodeImageModels(value) ?? [];
  const selection = decodeSubagentSelection(value ?? AUTOMATIC_SUBAGENTS);
  return selection === AUTOMATIC_SUBAGENTS ? [] : selection.map((ref) => encodeAdvisor(ref)!);
}

/** Wire value for a mode or a list. Image models' Automatic is the empty value (unset). */
function wireValue(setting: ModelSetting, next: "auto" | "off" | string[]): string {
  const images = isImageModelsSetting(setting);
  if (next === "auto") return images ? "" : AUTOMATIC_SUBAGENTS;
  if (next === "off" || next.length === 0) return "[]";
  if (images) return encodeImageModels(next) ?? "[]";
  return (
    encodeSubagents(
      next.flatMap((value) => {
        const ref = decodeAdvisor(value);
        return ref ? [ref] : [];
      }),
    ) ?? "[]"
  );
}

/**
 * Subagents or image models: Automatic, Custom or Off, and while Custom every chosen model in
 * view. Subagents list their models with an Add model picker; image models, a short fixed set,
 * show as a checklist. Choosing Custom stores nothing until a model is picked; removing the last
 * model turns the choice Off.
 */
export function DelegationSelectionControl({
  setting,
  value,
  label,
  disabled = false,
  disabledReason,
  onChange,
}: {
  setting: ModelSetting;
  /** The stored value; `undefined` is Automatic. */
  value: string | undefined;
  /** Translated name of the control; defaults to the setting's label. */
  label?: string;
  disabled?: boolean;
  /** Translated reason the control is locked. */
  disabledReason?: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState<{ value: string | undefined } | null>(null);
  const pickingCustom = !!picking && picking.value === value;
  const mode = pickingCustom ? "custom" : delegationMode(setting, value);
  const name = label ?? catalogText(t, setting.label);
  const picked = mode === "custom" ? pickedValues(setting, value) : [];
  const commit = (next: "auto" | "off" | string[]) => {
    setPicking(null);
    onChange(wireValue(setting, next));
  };
  return (
    <div className="flex w-full min-w-0 flex-col items-end gap-1">
      <SegmentedControl
        label={name}
        value={mode}
        options={[
          { value: "auto", label: t("Automatic"), disabled },
          { value: "custom", label: t("Custom"), disabled },
          { value: "off", label: t("Off"), disabled },
        ]}
        onValueChange={(next) => {
          if (next === "custom") {
            if (mode !== "custom") setPicking({ value });
            return;
          }
          commit(next as "auto" | "off");
        }}
      />
      {mode === "custom" ? (
        isImageModelsSetting(setting) ? (
          <DelegationChecklist
            setting={setting}
            label={name}
            selected={picked}
            disabled={disabled}
            disabledReason={disabledReason}
            onChange={commit}
          />
        ) : (
          <DelegationModelList
            setting={setting}
            label={name}
            selected={picked}
            limit={DELEGATION_LIMITS.subagentModels}
            disabled={disabled}
            disabledReason={disabledReason}
            onChange={commit}
          />
        )
      ) : null}
    </div>
  );
}
