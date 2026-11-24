import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { LiveText } from "../../../shared/ui/LiveText";
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
import { ArrowLeft, CheckList, Minus } from "../../../shared/ui/icons";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../../providers/public/providerAccounts";
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
 * grouped by provider, with a fixed footer for multi-select actions.
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
        accountKey: ref
          ? JSON.stringify([
              ref.harness,
              ref.providerAccountId ??
                (option.accountLabel ? DEFAULT_PROVIDER_ACCOUNT_ID : undefined),
            ])
          : "",
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
    const accountShownInFilter = Boolean(accountFilter && option.accountLabel);
    return {
      value: option.value,
      title:
        bulk && !accountShownInFilter
          ? delegationShortLabel(setting, option.value, t(option.label))
          : (option.modelLabel ?? delegationShortLabel(setting, option.value, t(option.label))),
      accessibleLabel: option.modelLabel
        ? [option.modelLabel, group, !bulk ? option.accountLabel : option.detail]
            .filter(Boolean)
            .join(", ")
        : undefined,
      icon: (
        <DelegationOptionIcon setting={setting} value={option.value} showAccountNumber={false} />
      ),
      meta:
        option.accountNumber !== undefined && !accountShownInFilter ? (
          <span className="inline-flex items-center gap-1">
            <ModelAccountNumber account={option} />
            {!bulk ? option.accountLabel : null}
          </span>
        ) : undefined,
      description: bulk ? undefined : option.detail,
      group: accountFilter ? undefined : group,
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
  const bulkActionLabel = clearShown ? t("Clear shown selection") : t("Select all shown");
  const BulkActionIcon = clearShown ? Minus : CheckList;

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
        <Button
          iconOnly
          variant="ghost"
          type="button"
          label={t("Back")}
          aria-label={t("Back")}
          onClick={onClose}
        >
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
      </div>
      <PopoverSearchHeader
        type="search"
        label={t("Search models")}
        placeholder={t("Search models")}
        value={query}
        onValueChange={setQuery}
        {...list.searchProps}
      />
      {bulk ? (
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-1">
          {accountOptions.length > 1 ? (
            <Select
              label={t("Accounts")}
              hideLabel
              fieldSize="sm"
              value={accountFilter}
              options={[{ value: "", label: t("All accounts") }, ...accountOptions]}
              onValueChange={setAccountFilter}
            />
          ) : null}
          <Button
            iconOnly
            label={bulkActionLabel}
            variant="secondary"
            size="sm"
            type="button"
            className="col-start-2"
            disabled={
              disabled ||
              !shown.length ||
              (!clearShown && modelCount >= DELEGATION_LIMITS.subagentModels)
            }
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
            <BulkActionIcon className="icon-sm" aria-hidden />
          </Button>
        </div>
      ) : null}
      <PickerList
        label={label}
        controller={list}
        density="sm"
        emptyLabel={t("No matching models")}
      />
      {multi ? (
        <PickerFooter align="between">
          <LiveText
            text={t("{p0} selected", { p0: bulk ? modelCount : picked })}
            size="caption"
            tone="secondary"
            truncate
            className="min-w-0 flex-1"
          />
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
