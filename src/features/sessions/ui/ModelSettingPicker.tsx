import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Select } from "../../../shared/ui/Select";
import {
  decodeAdvisor,
  decodeSubagents,
  DELEGATION_LIMITS,
} from "../../../shared/model/host-contracts/delegation";
import {
  PickerFooter,
  PickerList,
  PopoverSearchHeader,
  usePickerList,
} from "../../../shared/ui/picker";
import { ArrowLeft } from "../../../shared/ui/icons";
import {
  delegationOptionHarness,
  delegationOptionSelected,
  delegationNextValue,
  delegationShortLabel,
  type DelegationOption,
  isMultiSetting,
} from "../model/crossDelegation";
import { settingLabel } from "../model/modelPickerData";
import type { ModelSetting } from "../model/models";
import { HARNESS_TITLE } from "../model/session";
import { DelegationOptionIcon } from "./DelegationSettings";
import { ModelAccountNumber } from "./ModelAccountIdentity";

/**
 * A long choice (subagents, advisor) given the whole settings column: search on top, options
 * grouped by provider, and for multi-select a footer with Done that stays under the list.
 * @use Column navigation inside the model panel, built from shared picker primitives.
 * @avoid Standalone fields: SearchableSelect.
 * @replaces The model panel's local choice rows and search header.
 */
export function ModelSettingPicker({
  setting,
  values,
  disabled,
  onChoose,
  onClose,
  onApply,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  disabled: boolean;
  onChoose: (value: string) => void;
  onClose: () => void;
  /** Subagent lists are edited as a draft and committed once. */
  onApply?: (value: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const saved = values[setting.id] ?? setting.value;
  const [draft, setDraft] = useState(saved);
  const bulk = onApply !== undefined;
  const selection = bulk ? { ...values, [setting.id]: draft } : values;
  const modelCount = bulk ? decodeSubagents(draft).length : 0;
  const multi = isMultiSetting(setting);
  const label = t(settingLabel(setting));
  const needle = query.trim().toLocaleLowerCase();
  const settingOptions: DelegationOption[] = setting.options;
  const entries = settingOptions
    .filter((option) => !bulk || decodeAdvisor(option.value) !== undefined)
    .map((option) => {
      const ref = bulk ? decodeAdvisor(option.value) : undefined;
      const harness = delegationOptionHarness(setting, option.value);
      const provider = harness ? HARNESS_TITLE[harness] : undefined;
      const group = bulk && option.accountLabel ? `${provider} · ${option.accountLabel}` : provider;
      return {
        option,
        group,
        accountKey: ref ? JSON.stringify([ref.harness, ref.providerAccountId]) : "",
      };
    });
  const accountOptions = Array.from(
    new Map(
      entries.flatMap(({ accountKey, group }) => (group ? [[accountKey, group] as const] : [])),
    ),
    ([value, label]) => ({ value, label }),
  );
  const shown = entries.filter(
    ({ option, accountKey }) =>
      (!bulk || !accountFilter || accountFilter === accountKey) &&
      (!needle ||
        `${t(option.label)} ${option.accountLabel ?? ""}`.toLocaleLowerCase().includes(needle)),
  );
  const groups = new Map<string | undefined, typeof shown>();
  for (const entry of shown) {
    const group = groups.get(entry.group);
    if (group) group.push(entry);
    else groups.set(entry.group, [entry]);
  }
  const grouped = [...groups.values()].flat();
  const options = grouped.map(({ option, group }) => {
    const picked = delegationOptionSelected(setting, selection, option.value);
    return {
      value: option.value,
      title: option.modelLabel ?? delegationShortLabel(setting, option.value, t(option.label)),
      accessibleLabel: option.modelLabel
        ? [option.modelLabel, group, !bulk ? option.accountLabel : undefined]
            .filter(Boolean)
            .join(", ")
        : undefined,
      icon: (
        <DelegationOptionIcon setting={setting} value={option.value} showAccountNumber={false} />
      ),
      meta:
        option.accountNumber !== undefined ? (
          <span className="inline-flex items-center gap-1">
            <ModelAccountNumber account={option} />
            {!bulk ? option.accountLabel : null}
          </span>
        ) : undefined,
      description: option.detail,
      group,
      disabled: disabled || (bulk && !picked && modelCount >= DELEGATION_LIMITS.subagentModels),
    };
  });
  const selected = setting.options
    .filter((option) => delegationOptionSelected(setting, selection, option.value))
    .map((option) => option.value);
  const choose = (value: string) => {
    if (disabled) return;
    if (bulk) {
      setDraft((previous) => delegationNextValue(setting, { [setting.id]: previous }, value));
      return;
    }
    onChoose(value);
    if (!multi) onClose();
  };
  const list = usePickerList({
    options,
    resetKey: query,
    ...(multi
      ? {
          multiple: true as const,
          value: selected,
          onChange: (_values: string[], option: { value: string }) => choose(option.value),
        }
      : { value: selected[0] ?? null, onChange: choose }),
  });
  const picked = setting.options.filter(
    (option) =>
      option.value &&
      option.value !== "auto" &&
      delegationOptionSelected(setting, values, option.value),
  ).length;
  const addShown = shown.filter(({ option }) => !selected.includes(option.value));
  const clearShown = shown.length > 0 && addShown.length === 0;

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Handle Escape from any of the editor's keyboard controls.
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-model-setting-picker={setting.id}
      data-model-subagent-editor={bulk || undefined}
      onKeyDown={
        bulk
          ? (event) => {
              if (event.key !== "Escape" || event.defaultPrevented) return;
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          : undefined
      }
    >
      <div className="flex shrink-0 items-center gap-1.5 px-1.5 pt-1 pb-1.5">
        <Button iconOnly variant="ghost" type="button" label={t("Back")} onClick={onClose}>
          <ArrowLeft className="icon-sm" strokeWidth={1.75} />
        </Button>
        <Text
          as="span"
          size="caption"
          tone="inherit"
          weight="medium"
          truncate
          className="min-w-0 flex-1"
        >
          {label}
        </Text>
        {multi ? (
          <Text tone="secondary" size="caption">
            {t("{p0} selected", { p0: bulk ? modelCount : picked })}
          </Text>
        ) : null}
      </div>
      <PopoverSearchHeader
        type="search"
        label={t("Search models")}
        placeholder={t("Search models")}
        value={query}
        onValueChange={setQuery}
        {...list.searchProps}
      />
      {bulk && (accountOptions.length > 1 || shown.length >= 8) ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 px-2 py-1">
          {accountOptions.length > 1 ? (
            <Select
              label={t("Accounts")}
              hideLabel
              value={accountFilter}
              options={[{ value: "", label: t("All accounts") }, ...accountOptions]}
              onValueChange={setAccountFilter}
            />
          ) : null}
          {shown.length >= 8 ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={disabled || (!clearShown && modelCount >= DELEGATION_LIMITS.subagentModels)}
              onClick={() =>
                setDraft((previous) =>
                  (clearShown ? shown : addShown).reduce(
                    (next, { option }) =>
                      delegationNextValue(setting, { [setting.id]: next }, option.value),
                    previous,
                  ),
                )
              }
            >
              {clearShown ? t("Clear shown selection") : t("Select all shown")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <PickerList
        label={label}
        controller={list}
        density="sm"
        emptyLabel={t("No matching models")}
      />
      {multi ? (
        // Stays under the scrolling list, so Done never needs a scroll back up.
        <PickerFooter align="end">
          {bulk ? (
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              {t("Cancel")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            type="button"
            disabled={bulk && (disabled || draft === saved)}
            onClick={onApply ? () => onApply(draft || "[]") : onClose}
          >
            {bulk ? t("Apply") : t("Done")}
          </Button>
        </PickerFooter>
      ) : null}
    </div>
  );
}
