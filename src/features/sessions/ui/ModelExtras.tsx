import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { Button } from "../../../shared/ui/Button";

import { NativeSelect } from "../../../shared/ui/Select";
import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { SlidersHorizontal } from "../../../shared/ui/icons";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Popover } from "../../../shared/ui/Popover";
import {
  defaultModelSettings,
  getModelSnapshot,
  mergeModelSettings,
  subscribeModels,
} from "../model/models";
import {
  groupSettings,
  menuSettings,
  SETTING_GROUP_TITLE,
  settingLabel,
  settingValueLabel,
  settingValue,
  type SettingGroupId,
} from "../model/modelPickerData";
import { isDelegationSetting, isMultiSetting } from "../model/crossDelegation";
import {
  decodeSubagents,
  isReservedDelegationKey,
} from "../../../shared/model/host-contracts/delegation";
import type { AgentModel, ModelSetting } from "../model/models";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../model/session";
import { useModelSource, type ModelSource } from "./modelSource";
import {
  delegationSelectChoice,
  DelegationOptionIcon,
  DelegationSubagentsControl,
} from "./DelegationSettings";
import { subscribeProviderAccounts } from "../../providers/public/providerAccounts";
import { getAllRateLimits, subscribeRateLimits } from "../../providers/public/rateLimitsCache";
import { signedOutAccountKeys } from "../model/accountModelChoices";

/** Rows indented under the setting they depend on. */
const DEPENDENT = new Set(["subagentPolicy", "autoCompactWindow"]);

function subscribeExtrasSources(onChange: () => void): () => void {
  const offModels = subscribeModels(onChange);
  const offAccounts = subscribeProviderAccounts(onChange);
  return () => {
    offModels();
    offAccounts();
  };
}

function extraSettingsJson(
  current: AgentModel,
  source: ModelSource,
  usage: ReturnType<typeof getAllRateLimits>,
  t: ReturnType<typeof useT>,
  merged: Record<string, string>,
): string {
  return JSON.stringify(
    menuSettings({
      current,
      harnesses: HARNESSES.filter((id) => source.available(id)),
      source,
      accountChoices: true,
      signedOutAccounts: source.accounts === undefined ? signedOutAccountKeys(usage) : undefined,
      signedOutLabel: t("Not signed in"),
      savedAccountLabel: t("Saved account"),
      values: merged,
      unavailable: (name) => t("Unavailable: {p0}", { p0: name }),
    }),
  );
}

/** The current model's extras, their effective values and which differ from the defaults. */
function useModelExtras(harness: HarnessId, model: string, values: Record<string, string>) {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const source = useModelSource();
  const usage = useSyncExternalStore(subscribeRateLimits, getAllRateLimits, getAllRateLimits);
  const t = useT();
  const current = source.resolve(harness, model);
  // The merge reads the model catalog, so React reads it through the catalog's store.
  const merged: Record<string, string> = JSON.parse(
    useSyncExternalStore(
      subscribeModels,
      () => JSON.stringify(mergeModelSettings(current, values)),
      () => JSON.stringify(mergeModelSettings(current, values)),
    ),
  );
  // The delegation rows read the model catalog and local accounts, so React reads them through their stores.
  const settings: ModelSetting[] = JSON.parse(
    useSyncExternalStore(
      subscribeExtrasSources,
      () => extraSettingsJson(current, source, usage, t, merged),
      () => extraSettingsJson(current, source, usage, t, merged),
    ),
  );
  const effective = Object.fromEntries(
    [...(current.settings ?? []), ...settings.filter(isDelegationSetting)].map((setting) => [
      setting.id,
      merged[setting.id] ?? setting.value,
    ]),
  );
  const isInactive = (id: string) =>
    id === "subagentPolicy"
      ? (!effective.subagentModel || effective.subagentModel === "default") &&
        effective.crossSubagents !== "auto" &&
        decodeSubagents(effective.crossSubagents).length === 0
      : id === "autoCompactWindow" && effective.autoCompact === "off";
  const active = settings.filter(
    (s) => effective[s.id] !== (isDelegationSetting(s) ? "" : s.value) && !isInactive(s.id),
  );
  const changed = active.length;
  // Same groups and order as the picker menu: delegation, then Context, then Fast and Reasoning.
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
  compact = false,
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
  /** Inline pickers already provide their own title and saved-default reset. */
  compact?: boolean;
}) {
  const t = useT();
  const { current, effective, isInactive, changed, groups } = useModelExtras(
    harness,
    model,
    values,
  );
  const id = useId();
  const renderSetting = (setting: ModelSetting) => {
    const value = effective[setting.id] ?? setting.value;
    const dependent = DEPENDENT.has(setting.id);
    const inactive = isInactive(setting.id);
    const modified = value !== (isDelegationSetting(setting) ? "" : setting.value) && !inactive;
    const descriptionId = `${id}-${setting.id}-help`;
    const label = t(settingLabel(setting));
    const update = (next: string) => {
      if (disabled) return;
      // Off is an absent delegation key, never a stored empty value.
      const settings = {
        ...effective,
        [setting.id]:
          next ||
          (setting.id === "crossSubagents" ? "[]" : setting.id === "crossAdvisor" ? "null" : next),
      };
      if (setting.id === "crossSubagents") delete settings.subagentModel;
      // `advisor` is Claude Code's own setting; Off there also turns its built-in advisor off.
      if (setting.id === "crossAdvisor") {
        if (next || harness !== "claude") delete settings.advisor;
        else settings.advisor = "off";
      }
      for (const [key, entry] of Object.entries(settings))
        if (!entry && isReservedDelegationKey(key)) delete settings[key];
      onSettingsChange(settings);
    };
    return (
      <div
        key={setting.id}
        {...surfaceAttributes(
          { frame: dependent ? "pane" : undefined, edge: "left" },
          dependent ? "ms-2 border-s border-(--ui-tone-neutral-border) ps-2.5" : undefined,
        )}
      >
        <Text as="div" size="caption" tone="inherit" className="flex min-h-8 items-center gap-2">
          <Text
            size="inherit"
            tone={inactive ? "secondary" : "inherit"}
            className="flex min-w-0 flex-1 items-center gap-1"
          >
            <Text as="span" size="caption" tone="inherit" className="min-w-0 break-words">
              {label}
            </Text>
            {setting.description ? (
              <>
                <InfoPopover>{t(setting.description)}</InfoPopover>
                <span id={descriptionId} hidden>
                  {t(setting.description)}
                </span>
              </>
            ) : null}
            {modified && (
              <Tooltip label={t("Changed from default")} asChild>
                <span
                  {...surfaceAttributes(
                    { radius: "pill", variant: "accent-marker" },
                    "size-1.5 shrink-0",
                  )}
                />
              </Tooltip>
            )}
          </Text>
          {setting.kind === "toggle" ? (
            <Switch
              aria-label={label}
              aria-describedby={setting.description ? descriptionId : undefined}
              checked={value === "true"}
              disabled={disabled || inactive}
              onCheckedChange={(next) => update(String(next))}
            />
          ) : isMultiSetting(setting) ? (
            <DelegationSubagentsControl
              label={label}
              setting={setting}
              values={effective}
              disabled={disabled || inactive}
              onChange={update}
            />
          ) : ["advisor", "subagentModel", "crossAdvisor"].includes(setting.id) ? (
            <SearchableSelect
              hideLabel
              label={label}
              triggerProps={{
                "aria-label": label,
                "aria-describedby": setting.description ? descriptionId : undefined,
              }}
              value={value}
              disabled={disabled || inactive}
              onChange={update}
              options={setting.options.map((option) => ({
                value: option.value,
                ...delegationSelectChoice(setting, option, t),
                icon: isDelegationSetting(setting) ? (
                  <DelegationOptionIcon setting={setting} value={option.value} />
                ) : undefined,
              }))}
            />
          ) : (
            <NativeSelect
              aria-label={label}
              aria-describedby={setting.description ? descriptionId : undefined}
              value={value}
              disabled={disabled || inactive}
              onChange={(e) => update(e.target.value)}
              className="w-[52%] max-w-[11.5rem] min-w-0 shrink-0"
              truncate
            >
              {setting.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Text>
      </div>
    );
  };
  return (
    <>
      {/* z-10: in-popover sticky header over the scrolling list; no in-pane layer scale exists, so the literal stays. */}
      {!compact && (
        <div
          {...surfaceAttributes(
            { frame: "pane", edge: "bottom", variant: "floating" },
            "sticky top-0 z-(--layer-pane-sheet)  border-(--ui-tone-neutral-border) px-3 pt-2.5 pb-2",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            {leading}
            <Text
              as="span"
              size="caption"
              tone="inherit"
              weight="medium"
              truncate
              className="min-w-0 flex-1"
            >
              {title ?? `${HARNESS_TITLE[harness]} · ${t("Extras")}`}
            </Text>
            {changed > 0 ? (
              <Button
                variant="ghost"
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onSettingsChange(defaultModelSettings(current));
                }}
              >
                {t("Reset extras")}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      <div className="space-y-3 px-3 pt-2 pb-3">
        {groups.map((group) => (
          <section key={group.id}>
            {group.title && <SectionLabel className="mb-1">{t(group.title)}</SectionLabel>}
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
        iconOnly={changed === 0}
        label={t("Extras")}
        tooltip={
          showSummary && changed > 0
            ? active.map((setting) => t(settingValueLabel(setting, effective))).join(" · ")
            : undefined
        }
        aria-haspopup="dialog"
        expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-extras-trigger
        className="shrink-0"
      >
        <SlidersHorizontal className="icon-xs shrink-0" strokeWidth={1.75} />
        {changed > 0 && (
          <Text
            as="span"
            tone="neutral"
            {...surfaceAttributes({ radius: "sm", variant: "selection" }, "px-1")}
          >
            {changed}
          </Text>
        )}
      </Button>
      {open && (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={340}
          maxHeight={460}
          kind="dialog"
          data-model-settings
          aria-label={t("Provider extras")}
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

export function TogglePill({
  setting,
  values,
  onSettingsChange,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  onSettingsChange: (settings: Record<string, string>) => void;
}) {
  const t = useT();
  const on = settingValue(setting, values) === "true";
  const label = t(settingLabel(setting));
  return (
    <Button
      variant="chip"
      type="button"
      aria-label={label}
      aria-pressed={on}
      selected={on}
      data-model-control
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSettingsChange({ ...values, [setting.id]: on ? "false" : "true" })}
      className="max-w-28"
    >
      <Text size="micro" tone={on ? "inherit" : "secondary"} truncate>
        {label}
      </Text>
    </Button>
  );
}

/**
 * The delegation rows (advisor, subagents, subagent max effort, image models) as offered for a
 * provider, for editors that are not tied to one model selection. Option labels follow the
 * catalog and signed-in accounts; `values` are the stored keys of the layer being edited.
 */
export function useDelegationSettings(
  harness: HarnessId,
  values: Record<string, string>,
): ModelSetting[] {
  return useModelExtras(harness, "", values).settings.filter(isDelegationSetting);
}
