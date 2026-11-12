import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
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
  isMultiSetting,
} from "../model/crossDelegation";
import { settingLabel } from "../model/modelPickerData";
import type { ModelSetting } from "../model/models";
import { HARNESS_TITLE } from "../model/session";
import { DelegationOptionIcon } from "./DelegationSettings";

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
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  disabled: boolean;
  onChoose: (value: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const multi = isMultiSetting(setting);
  const label = t(settingLabel(setting));
  const needle = query.trim().toLocaleLowerCase();
  // Options are grouped under their provider, so a leading "Provider · " repeats the heading.
  const optionLabel = (option: (typeof setting.options)[number]) => {
    const text = t(option.label);
    const harness = delegationOptionHarness(setting, option.value);
    const prefix = harness ? `${HARNESS_TITLE[harness]} · ` : "";
    return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
  };
  const shown = setting.options.filter(
    (option) => !needle || t(option.label).toLocaleLowerCase().includes(needle),
  );
  const options = shown.map((option) => {
    const harness = delegationOptionHarness(setting, option.value);
    return {
      value: option.value,
      title: optionLabel(option),
      icon: <DelegationOptionIcon setting={setting} value={option.value} />,
      group: harness ? HARNESS_TITLE[harness] : undefined,
      disabled,
    };
  });
  const selected = setting.options
    .filter((option) => delegationOptionSelected(setting, values, option.value))
    .map((option) => option.value);
  const choose = (value: string) => {
    if (disabled) return;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-model-setting-picker={setting.id}>
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
      <PickerList
        label={label}
        controller={list}
        density="sm"
        emptyLabel={t("No matching models")}
      />
      {multi ? (
        // Stays under the scrolling list, so Done never needs a scroll back up.
        <PickerFooter align="between">
          <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
            {t("{p0} selected", { p0: picked })}
          </Text>
          <Button variant="primary" size="sm" type="button" onClick={onClose}>
            {t("Done")}
          </Button>
        </PickerFooter>
      ) : null}
    </div>
  );
}
