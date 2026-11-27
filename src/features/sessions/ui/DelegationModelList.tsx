import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Plus, X } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Text } from "../../../shared/ui/Text";
import { ModelAccountLabel } from "./ModelAccountIdentity";
import type { DelegationOption } from "../model/crossDelegation";
import type { ModelSetting } from "../model/models";
import { delegationPickerOption, delegationPickerOptions } from "./DelegationSettings";

/**
 * The models of a custom delegation list, all visible: one row each with the provider icon, the
 * model, its account and a remove action, then an Add model picker that renders its rows like the
 * composer's model picker. `selected` holds option values in their saved order.
 */
export function DelegationModelList({
  setting,
  label,
  selected,
  limit,
  disabled = false,
  disabledReason,
  onChange,
}: {
  setting: ModelSetting;
  /** Accessible name of the list. */
  label: string;
  selected: readonly string[];
  /** Most models the list may hold; further choices are disabled in the picker. */
  limit?: number;
  disabled?: boolean;
  /** Translated reason the list is locked. */
  disabledReason?: string;
  onChange: (selected: string[]) => void;
}) {
  const t = useT();
  const options: DelegationOption[] = setting.options;
  const full = limit !== undefined && selected.length >= limit;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      {selected.length ? (
        <ul aria-label={label} className="flex min-w-0 flex-col">
          {selected.map((value) => {
            const option = options.find((item) => item.value === value);
            const row = option ? delegationPickerOption(setting, option, t) : undefined;
            const name = row?.label ?? t("Unavailable model");
            return (
              <li
                key={value}
                data-delegation-model
                className="flex min-h-8 min-w-0 items-center gap-2"
              >
                <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
                  {row?.icon}
                </span>
                <Text size="secondary" truncate className="min-w-0 shrink">
                  {name}
                </Text>
                <Text
                  size="caption"
                  tone="muted"
                  className="flex min-w-0 flex-1 items-center gap-1"
                >
                  {/* The provider names the copy: Claude Code's Sonnet and OpenCode's are different runs. */}
                  {row?.group ? <span className="shrink-0">{row.group}</span> : null}
                  {option?.accountLabel ? (
                    <ModelAccountLabel account={{ ...option, accountLabel: option.accountLabel }} />
                  ) : (
                    option?.detail
                  )}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  type="button"
                  label={t("Remove {p0}", { p0: name })}
                  disabled={disabled}
                  disabledReason={disabledReason}
                  onClick={() => onChange(selected.filter((item) => item !== value))}
                >
                  <X className="icon-sm" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <SearchableSelect
        multiple
        hideLabel
        label={t("Add model")}
        searchPlaceholder={t("Search models")}
        value={selected}
        disabled={disabled}
        disabledReason={disabledReason}
        align="end"
        menuMinWidth={320}
        menuMaxHeight={360}
        options={delegationPickerOptions(setting, t).map((option) => ({
          ...option,
          disabled: option.disabled || (full && !selected.includes(option.value)),
        }))}
        onChange={onChange}
        renderTrigger={({ props }) => (
          <Button
            {...props}
            variant="ghost"
            size="sm"
            startIcon={<Plus className="icon-sm" aria-hidden />}
            className="self-end"
          >
            {t("Add model")}
          </Button>
        )}
      />
    </div>
  );
}

/** A short fixed list (image models) as checkboxes, every choice visible at once. */
export function DelegationChecklist({
  setting,
  label,
  selected,
  disabled = false,
  disabledReason,
  onChange,
}: {
  setting: ModelSetting;
  label: string;
  selected: readonly string[];
  disabled?: boolean;
  disabledReason?: string;
  onChange: (selected: string[]) => void;
}) {
  const t = useT();
  const options = delegationPickerOptions(setting, t);
  return (
    <ul aria-label={label} className="flex w-full min-w-0 flex-col">
      {options.map((option) => (
        <li key={option.value} className="flex min-h-8 min-w-0 items-center">
          <Checkbox
            label={
              <span className="inline-flex min-w-0 items-center gap-2">
                {option.icon}
                <Text size="inherit" tone="inherit" truncate className="min-w-0">
                  {option.label}
                </Text>
              </span>
            }
            checked={selected.includes(option.value)}
            disabled={disabled || option.disabled}
            disabledReason={disabled ? disabledReason : option.disabledReason}
            onChange={(event) =>
              onChange(
                event.currentTarget.checked
                  ? [...selected, option.value]
                  : selected.filter((item) => item !== option.value),
              )
            }
          />
        </li>
      ))}
    </ul>
  );
}
