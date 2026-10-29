import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { Button } from "../../../shared/ui/Button";

import { NativeSelect } from "../../../shared/ui/Select";
import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { ChevronDown, CircleHelp, SlidersHorizontal } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  defaultModelSettings,
  getModelSnapshot,
  mergeModelSettings,
  subscribeModels,
} from "../model/models";
import { offeredDelegationSetting } from "../model/claudeAdvisor";
import {
  groupSettings,
  pickerSettings,
  SETTING_GROUP_TITLE,
  settingLabel,
  type SettingGroupId,
} from "../model/modelPickerData";
import type { ModelSetting } from "../model/models";
import type { HarnessId } from "../model/session";
import { HARNESS_TITLE } from "../model/session";
import { useModelSource } from "./modelSource";

/** Rows indented under the setting they depend on. */
const DEPENDENT = new Set(["subagentPolicy", "autoCompactWindow"]);

/** The current model's extras, their effective values and which differ from the defaults. */
function useModelExtras(harness: HarnessId, model: string, values: Record<string, string>) {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const source = useModelSource();
  const current = source.resolve(harness, model);
  const merged = mergeModelSettings(current, values);
  const offered = source.modelsFor(harness);
  const settings = pickerSettings(current).map((setting) =>
    offeredDelegationSetting(setting, offered, merged[setting.id] ?? setting.value),
  );
  const effective = Object.fromEntries(
    (current.settings ?? []).map((setting) => [setting.id, merged[setting.id] ?? setting.value]),
  );
  const isInactive = (id: string) =>
    id === "subagentPolicy"
      ? !effective.subagentModel || effective.subagentModel === "default"
      : id === "autoCompactWindow" && effective.autoCompact === "off";
  const active = settings.filter((s) => effective[s.id] !== s.value && !isInactive(s.id));
  const changed = active.length;
  // Same groups and order as the picker menu: model options, then Context, then delegation.
  const grouped = groupSettings(settings);
  const groups: Array<{ id: SettingGroupId; title?: string; settings: ModelSetting[] }> =
    grouped.length > 1 || (grouped[0] && grouped[0].id !== "model")
      ? grouped.map((group) => ({ ...group, title: SETTING_GROUP_TITLE[group.id] }))
      : [{ id: "model", settings }];
  return { current, settings, effective, isInactive, active, changed, groups };
}

/**
 * The extras form for the current model selection: shared by the toolbar
 * chip's popover and the model picker's Extras view.
 */
export function ModelExtrasPanel({
  harness,
  model,
  values,
  onSettingsChange,
  disabled = false,
  title,
  leading,
}: {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  onSettingsChange: (values: Record<string, string>) => void;
  disabled?: boolean;
  /** Replaces the "<harness> · Extras" heading. */
  title?: string;
  /** Rendered before the heading, e.g. a back button. */
  leading?: ReactNode;
}) {
  const t = useT();
  const { current, effective, isInactive, changed, groups } = useModelExtras(
    harness,
    model,
    values,
  );
  const id = useId();
  const [explained, setExplained] = useState<string | null>(null);
  const renderSetting = (setting: ModelSetting) => {
    const value = effective[setting.id] ?? setting.value;
    const dependent = DEPENDENT.has(setting.id);
    const inactive = isInactive(setting.id);
    const modified = value !== setting.value && !inactive;
    const descriptionId = `${id}-${setting.id}-help`;
    const showHelp = explained === setting.id;
    const label = t(settingLabel(setting));
    const update = (next: string) => {
      if (!disabled) onSettingsChange({ ...effective, [setting.id]: next });
    };
    return (
      <div
        key={setting.id}
        className={dependent ? "ml-2 border-l border-(--ui-tone-neutral-border) pl-2.5" : undefined}
      >
        <div className="flex min-h-8 items-center gap-2 text-ui-caption">
          <span
            className={`flex min-w-0 flex-1 items-center gap-1 ${inactive ? "text-(--ui-text-secondary)" : ""}`}
          >
            <span className="min-w-0 leading-4 break-words">{label}</span>
            {modified && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-(--color-accent)"
                title={t("Changed from default")}
              />
            )}
            {setting.description && (
              <Button
                className="shrink-0"
                iconOnly
                label={t("About {p0}", { p0: label })}
                variant="ghost"
                type="button"
                aria-label={t("About {p0}", { p0: label })}
                aria-expanded={showHelp}
                aria-controls={descriptionId}
                onClick={() => setExplained(showHelp ? null : setting.id)}
              >
                <CircleHelp className="size-3" />
              </Button>
            )}
          </span>
          {setting.kind === "toggle" ? (
            <Switch
              aria-label={label}
              aria-describedby={setting.description ? descriptionId : undefined}
              checked={value === "true"}
              disabled={disabled || inactive}
              onCheckedChange={(next) => update(String(next))}
            />
          ) : ["advisor", "subagentModel"].includes(setting.id) ? (
            <NativeSearchableSelect
              label={label}
              aria-label={label}
              aria-describedby={setting.description ? descriptionId : undefined}
              value={value}
              disabled={disabled || inactive}
              onChange={(e) => update(e.target.value)}
              options={setting.options.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
            />
          ) : (
            <NativeSelect
              aria-label={label}
              aria-describedby={setting.description ? descriptionId : undefined}
              value={value}
              disabled={disabled || inactive}
              onChange={(e) => update(e.target.value)}
              className="w-[52%] max-w-[11.5rem] min-w-0 shrink-0 truncate"
            >
              {setting.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        {setting.description && (
          <p
            id={descriptionId}
            hidden={!showHelp}
            className="mb-1 rounded-md bg-(--ui-surface-raised) px-2 py-1.5 text-(length:--ui-font-caption) leading-4 text-(--ui-text-secondary)"
          >
            {t(setting.description)}
          </p>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-(--ui-tone-neutral-border) bg-(--ui-surface) px-3 pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          {leading}
          <span className="min-w-0 flex-1 truncate text-ui-caption font-medium">
            {title ?? `${HARNESS_TITLE[harness]} · ${t("Extras")}`}
          </span>
          <Button
            variant="ghost"
            type="button"
            disabled={disabled || changed === 0}
            onClick={() => {
              if (!disabled) onSettingsChange(defaultModelSettings(current));
            }}
            className="shrink-0"
          >
            {t("Reset extras")}
          </Button>
        </div>
        <p className="mt-0.5 text-(length:--ui-font-caption) leading-4 text-(--ui-text-secondary)">
          {t("Extras apply to this model selection. They do not change the main model.")}
        </p>
      </div>
      <div className="space-y-3 px-3 pt-2 pb-3">
        {groups.map((group) => (
          <section key={group.id}>
            {group.title && (
              <h3 className="mb-1 text-(length:--ui-font-caption) font-medium text-(--ui-text-secondary)">
                {t(group.title)}
              </h3>
            )}
            <div className="space-y-0.5">
              {group.settings.map((setting) => renderSetting(setting))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** Whether the model has any extras, and how many differ from the defaults. */
export function useModelExtrasSummary(
  harness: HarnessId,
  model: string,
  values: Record<string, string>,
) {
  const { settings, changed } = useModelExtras(harness, model, values);
  return { available: settings.length > 0, changed };
}

export function ModelExtras({
  harness,
  model,
  values,
  onSettingsChange,
  disabled = false,
  onClose,
  showSummary = false,
}: {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  onSettingsChange: (values: Record<string, string>) => void;
  disabled?: boolean;
  onClose?: () => void;
  showSummary?: boolean;
}) {
  const t = useT();
  const { settings, effective, active, changed } = useModelExtras(harness, model, values);
  // The popover belongs to the model and enabled state it was opened for.
  const ownerKey = `${harness}\u0000${model}\u0000${disabled}`;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === ownerKey;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) =>
    setOpenFor((previous) => {
      const was = previous === ownerKey;
      return (typeof next === "function" ? next(was) : next) ? ownerKey : null;
    });
  const anchor = useRef<HTMLButtonElement>(null);
  if (!settings.length) return null;
  const dismiss = () => {
    setOpen(false);
    anchor.current?.focus();
    onClose?.();
  };
  return (
    <>
      <Button
        variant="ghost"
        ref={anchor}
        type="button"
        data-model-control
        aria-label={t("Extras")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-extras-trigger
        className="shrink-0"
      >
        <SlidersHorizontal className="size-3 shrink-0" strokeWidth={1.75} />
        <span data-extras-label>{t("Extras")}</span>
        {changed > 0 && (
          <span className="rounded bg-selection px-1 text-(length:--ui-font-caption) text-(--ui-tone-neutral-fg)">
            {changed}
          </span>
        )}
        {showSummary && changed > 0 && (
          <span data-extras-summary className="max-w-40 truncate text-(--ui-text-secondary)">
            {active
              .map((s) =>
                t(s.options.find((o) => o.value === effective[s.id])?.label ?? effective[s.id]),
              )
              .join(" · ")}
          </span>
        )}
        <ChevronDown className="size-3" />
      </Button>
      {open && (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={340}
          maxHeight={460}
          role="dialog"
          data-model-settings
          aria-label={t("Provider extras")}
          autoFocus
          onDismiss={dismiss}
          className="overflow-y-auto"
        >
          <ModelExtrasPanel
            harness={harness}
            model={model}
            values={values}
            onSettingsChange={onSettingsChange}
            disabled={disabled}
          />
        </Popover>
      )}
    </>
  );
}
