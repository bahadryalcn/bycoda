import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { ArrowLeft, Check } from "../../../shared/ui/icons";
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
  const groups = new Map<string, typeof shown>();
  for (const option of shown) {
    const harness = delegationOptionHarness(setting, option.value);
    const key = harness ? HARNESS_TITLE[harness] : "";
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  const picked = setting.options.filter(
    (option) => option.value && delegationOptionSelected(setting, values, option.value),
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
          tooltip={t("Back")}
          onClick={onClose}
        >
          <ArrowLeft className="icon-sm" strokeWidth={1.75} />
        </Button>
        <span className="min-w-0 flex-1 truncate text-ui-caption font-medium">{label}</span>
      </div>
      <div className="shrink-0 px-1.5 pb-1.5">
        <SearchInput
          type="search"
          appearance="field"
          autoFocus
          aria-label={t("Search models")}
          placeholder={t("Search models")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={label}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1"
      >
        {shown.length === 0 ? (
          <p className="px-1.5 py-2 ui-caption-text">{t("No matching models")}</p>
        ) : (
          [...groups].map(([group, options]) => (
            <div key={group || "none"}>
              {group ? (
                <div className="px-1.5 pt-2 pb-0.5 text-ui-micro font-medium tracking-wide text-(--ui-text-secondary) uppercase">
                  {group}
                </div>
              ) : null}
              {options.map((option) => {
                const selected = delegationOptionSelected(setting, values, option.value);
                return (
                  <Button
                    key={option.value}
                    variant="item"
                    fullWidth
                    type="button"
                    role={multi ? "checkbox" : "radio"}
                    aria-checked={selected}
                    selected={selected}
                    disabled={disabled}
                    className="w-full text-left"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChoose(option.value);
                      if (!multi) onClose();
                    }}
                  >
                    <DelegationOptionIcon setting={setting} value={option.value} />
                    <span className={`min-w-0 flex-1 truncate ${selected ? "font-medium" : ""}`}>
                      {optionLabel(option)}
                    </span>
                    {selected ? (
                      <Check
                        className="icon-sm shrink-0 text-(--ui-tone-neutral-fg)"
                        strokeWidth={2}
                      />
                    ) : (
                      <span className="size-3.5 shrink-0" aria-hidden />
                    )}
                  </Button>
                );
              })}
            </div>
          ))
        )}
      </div>
      {multi ? (
        // Stays under the scrolling list, so Done never needs a scroll back up.
        <div className="flex shrink-0 items-center gap-2 border-t border-(--ui-frosted-divider) px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate ui-caption-text">
            {t("{p0} selected", { p0: picked })}
          </span>
          <Button variant="primary" size="sm" type="button" onClick={onClose}>
            {t("Done")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
