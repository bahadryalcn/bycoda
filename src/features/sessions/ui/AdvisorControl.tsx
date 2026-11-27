import { useT } from "../../../shared/i18n";
import { decodeAdvisor } from "../../../shared/model/host-contracts/delegation";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { catalogText } from "../model/catalogText";
import type { ModelSetting } from "../model/models";
import { delegationPickerOptions } from "./DelegationSettings";

/**
 * The advisor as a switch, with its model picker beside it while it is on. The switch keeps its
 * place; the picker appears before it. Turning it on picks `fallback` when offered, else the
 * first available model. `onChange("")` turns the advisor off.
 */
export function AdvisorControl({
  setting,
  value,
  fallback,
  label,
  disabled = false,
  onChange,
}: {
  setting: ModelSetting;
  /** The effective advisor: an encoded model, or empty / `null` for Off. */
  value: string | undefined;
  /** Model to start on when the switch turns on, such as the inherited advisor. */
  fallback?: string;
  label?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const name = label ?? catalogText(t, setting.label);
  const options = delegationPickerOptions(setting, t);
  const on = !!value && !!decodeAdvisor(value);
  const first =
    options.find((option) => option.value === fallback && !option.disabled) ??
    options.find((option) => !option.disabled);
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {on ? (
        <div className="min-w-0 max-w-64">
          <SearchableSelect
            hideLabel
            label={t("{p0} model", { p0: name })}
            searchPlaceholder={t("Search models")}
            value={value!}
            disabled={disabled}
            align="end"
            menuMinWidth={320}
            menuMaxHeight={360}
            options={options}
            onChange={onChange}
          />
        </div>
      ) : null}
      <Switch
        aria-label={name}
        checked={on}
        compact
        disabled={disabled || (!on && !first)}
        onCheckedChange={(next) => onChange(next ? (first?.value ?? "") : "")}
      />
    </div>
  );
}
