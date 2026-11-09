import { useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { formatNumber } from "../../../shared/i18n/core";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Switch } from "../../../shared/ui/Switch";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { ChevronDown, CircleHelp, Plus, X } from "../../../shared/ui/icons";
import {
  delegationOptionSelected,
  delegationShortLabel,
  isDelegationSetting,
  isMultiSetting,
  isSubagentSetting,
} from "../model/crossDelegation";
import {
  ascendingEffortOptions,
  settingControlKind,
  settingGridColumns,
  splitPanelSettings,
} from "../model/modelPanelData";
import { settingLabel, settingValue } from "../model/modelPickerData";
import type { AgentModel, ModelSetting } from "../model/models";
import { HARNESS_TITLE } from "../model/session";
import { DelegationField, DelegationOptionIcon } from "./DelegationSettings";
import { ModelSettingPicker } from "./ModelSettingPicker";

type PanelTab = "settings" | "agents";

/** Help shown for settings whose catalog entry carries no description. */
const FALLBACK_HELP: Record<string, string> = {
  effort:
    "How long the model thinks before it answers. Higher levels are slower and use more of the account limit.",
  fast: "Same model, faster output at a higher cost.",
};

function helpText(setting: ModelSetting): string | undefined {
  if (setting.description) return setting.description;
  if (settingControlKind(setting) === "effort") return FALLBACK_HELP.effort;
  return setting.id === "fast" ? FALLBACK_HELP.fast : undefined;
}

/** The panel-wide strip under both columns that explains the pointed-at setting. */
export function ModelSettingHelp({ setting }: { setting: ModelSetting | null }) {
  const t = useT();
  const help = setting ? helpText(setting) : undefined;
  return (
    <div
      data-model-setting-help
      className="flex shrink-0 items-start gap-2 border-t border-(--ui-frosted-divider) px-3 py-1.5 ui-caption-text"
    >
      <CircleHelp className="icon-xs mt-0.5 shrink-0" aria-hidden />
      <p className="line-clamp-3 min-w-0 leading-4">
        {setting && help ? (
          <>
            <span className="font-medium text-(--ui-tone-neutral-fg)">
              {t(settingLabel(setting))}
            </span>{" "}
            {t(help)}
          </>
        ) : (
          t("Point at a setting to read what it does.")
        )}
      </p>
    </div>
  );
}

/**
 * The selected model's options beside the model list. Every control is inline, so nothing opens
 * over the panel; hovering a setting names it to the panel's help strip instead of a tooltip.
 */
export function ModelSettingsColumn({
  current,
  settings,
  values,
  locked,
  onChoose,
  onExplain,
}: {
  current: AgentModel;
  settings: ModelSetting[];
  values: Record<string, string>;
  locked: (setting: ModelSetting) => boolean;
  /** Applies one picked value; subagent choices toggle in place. */
  onChoose: (setting: ModelSetting, value: string) => void;
  /** The setting under the pointer or focus, for the panel's help strip. */
  onExplain: (setting: ModelSetting | null) => void;
}) {
  const t = useT();
  const { model, agents } = splitPanelSettings(settings);
  const [tab, setTab] = useState<PanelTab>("settings");
  const [explainedId, setExplainedId] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const shownTab: PanelTab = agents.length === 0 ? "settings" : model.length === 0 ? "agents" : tab;
  const shown = shownTab === "settings" ? model : agents;
  const setExplained = (next: ModelSetting | null) => {
    setExplainedId(next?.id ?? null);
    onExplain(next);
  };
  const picking = shown.find((setting) => setting.id === pickingId);
  const subagentCount = agents
    .filter(isSubagentSetting)
    .flatMap((setting) =>
      setting.options.filter(
        (option) => option.value && delegationOptionSelected(setting, values, option.value),
      ),
    ).length;

  // Hover or focus names the setting whose help the strip shows.
  const explain = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-setting-id]")?.dataset
      .settingId;
    const next = shown.find((setting) => setting.id === id) ?? null;
    if ((next?.id ?? null) !== explainedId) setExplained(next);
  };

  return (
    <div
      data-model-settings
      className="flex min-h-0 w-60 shrink-0 flex-col border-l border-(--ui-tone-neutral-border) @max-[32rem]/model-panel:h-1/2 @max-[32rem]/model-panel:w-full @max-[32rem]/model-panel:border-t @max-[32rem]/model-panel:border-l-0"
    >
      {agents.length > 0 && model.length > 0 ? (
        <Tabs
          value={shownTab}
          onValueChange={(next) => {
            setTab(next as PanelTab);
            setPickingId(null);
          }}
          size="sm"
          fill
        >
          <TabList label={t("Model options")} className="shrink-0 px-2 pt-1.5">
            <Tab value="settings">{t("Settings")}</Tab>
            <Tab value="agents" count={subagentCount || null}>
              {t("Agents")}
            </Tab>
          </TabList>
        </Tabs>
      ) : null}
      {picking ? (
        <ModelSettingPicker
          setting={picking}
          values={values}
          disabled={locked(picking)}
          onChoose={(value) => onChoose(picking, value)}
          onClose={() => setPickingId(null)}
        />
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none px-1.5 pt-1 pb-2"
          onMouseOver={explain}
          onFocus={explain}
          onMouseLeave={() => setExplained(null)}
        >
          {shown.length === 0 ? (
            <p className="px-1.5 py-2 ui-caption-text">
              {t("{p0} has no extra options.", { p0: HARNESS_TITLE[current.harness] })}
            </p>
          ) : (
            shown.map((setting) => (
              <SettingRow
                key={setting.id}
                setting={setting}
                values={values}
                disabled={locked(setting)}
                onChoose={(value) => onChoose(setting, value)}
                onPick={() => setPickingId(setting.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  setting,
  values,
  disabled,
  onChoose,
  onPick,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  disabled: boolean;
  onChoose: (value: string) => void;
  /** Opens the column-wide picker for a long choice. */
  onPick: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const labels = setting.options.map((option) => t(option.label));
  const kind = settingControlKind(setting, labels);
  const label = t(settingLabel(setting));
  const value = settingValue(setting, values);
  const valueLabel = labels[setting.options.findIndex((option) => option.value === value)] ?? value;
  const help = helpText(setting);
  const describedBy = help ? `model-setting-help-${setting.id}` : undefined;
  const hiddenHelp = help ? (
    <span id={describedBy} hidden>
      {t(help)}
    </span>
  ) : null;
  const row =
    "flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md px-1.5";
  const name = <span className="min-w-0 truncate text-ui-caption font-medium">{label}</span>;
  const heading = (trailing: ReactNode) => (
    <div className="flex items-baseline justify-between px-1.5 pt-2 pb-1.5">
      <span className="text-ui-micro font-medium tracking-wide text-(--ui-text-secondary) uppercase">
        {label}
      </span>
      {trailing}
    </div>
  );

  if (kind === "toggle") {
    return (
      <div data-setting-id={setting.id} className={row}>
        {name}
        <Switch
          aria-label={label}
          aria-describedby={describedBy}
          checked={value === "true"}
          disabled={disabled}
          onCheckedChange={(next) => onChoose(String(next))}
        />
        {hiddenHelp}
      </div>
    );
  }

  if (kind === "effort") {
    return (
      <div data-setting-id={setting.id} className="pb-1">
        {heading(
          <span
            className={`text-ui-caption font-medium ${isUltraEffort(value) ? "text-(--ui-tone-warning-fg)" : ""}`}
          >
            {valueLabel}
          </span>,
        )}
        <EffortBars
          setting={setting}
          labels={labels}
          value={value}
          label={label}
          describedBy={describedBy}
          disabled={disabled}
          onChoose={onChoose}
        />
        {hiddenHelp}
      </div>
    );
  }

  // A short delegation choice fits a segmented switch too. The subagent policy always does: one
  // row of tabs right above the Subagents it governs, named by the help strip.
  const policy = setting.id === "subagentPolicy";
  const shortChoice =
    kind === "choices" &&
    !isMultiSetting(setting) &&
    (policy || settingControlKind({ ...setting, id: "" }, labels) === "segmented");
  if (kind === "segmented" || shortChoice) {
    return (
      <div data-setting-id={setting.id} className={row}>
        {policy ? null : name}
        <SegmentedControl
          label={label}
          value={value}
          onValueChange={onChoose}
          options={setting.options.map((option, index) => ({
            value: option.value,
            label: labels[index],
            disabled,
          }))}
        />
        {hiddenHelp}
      </div>
    );
  }

  if (kind === "choices") {
    const picked = setting.options.filter(
      (option) => option.value && delegationOptionSelected(setting, values, option.value),
    );
    if (isMultiSetting(setting)) {
      // Picked subagents read as chips; the full list opens only to add more.
      // Last in the column, the list shrinks and scrolls on its own so the rows above stay put.
      return (
        <div data-setting-id={setting.id} className="flex min-h-0 flex-col pb-1 not-last:shrink-0">
          {heading(
            <span className="ui-caption-text">
              {/* No image model picked means every available one may be used. */}
              {picked.length || isSubagentSetting(setting)
                ? formatNumber(picked.length)
                : t("Automatic")}
            </span>,
          )}
          <div
            className="flex min-h-0 flex-wrap content-start gap-1 overflow-y-auto overscroll-none px-1.5"
            role="group"
            aria-label={label}
          >
            {picked.map((option) => (
              <span
                key={option.value}
                className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-(--ui-tone-neutral-border) py-0.5 ps-2 pe-0.5 text-ui-caption"
              >
                <DelegationOptionIcon setting={setting} value={option.value} />
                <span className="min-w-0 truncate">
                  {delegationShortLabel(setting, option.value, t(option.label))}
                </span>
                <Button
                  iconOnly
                  size="sm"
                  variant="ghost"
                  shape="pill"
                  type="button"
                  disabled={disabled}
                  label={t("Remove {p0}", { p0: t(option.label) })}
                  aria-label={t("Remove {p0}", { p0: t(option.label) })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onChoose(option.value)}
                >
                  <X className="icon-xs" />
                </Button>
              </span>
            ))}
            <Button
              size="sm"
              variant="ghost"
              shape="pill"
              type="button"
              disabled={disabled}
              aria-describedby={describedBy}
              data-model-setting-add
              onMouseDown={(event) => event.preventDefault()}
              onClick={onPick}
            >
              <Plus className="icon-xs" />
              {t("Add")}
            </Button>
          </div>
          {hiddenHelp}
        </div>
      );
    }
    if (!isDelegationSetting(setting) && setting.options.length <= SHORT_LIST_MAX) {
      // Too long for a segmented switch: each choice stays readable on its own full-width row.
      return (
        <div data-setting-id={setting.id} className="pb-1">
          {heading(null)}
          <OptionGrid
            setting={setting}
            labels={labels}
            value={value}
            label={label}
            columns="grid-cols-1"
            disabled={disabled}
            onChoose={onChoose}
          />
          {hiddenHelp}
        </div>
      );
    }
    if (isDelegationSetting(setting)) {
      return (
        <div data-setting-id={setting.id} className="px-1.5 py-1">
          <DelegationField
            setting={setting}
            label={label}
            picked={picked[0]}
            emptyLabel={labels[0]}
            disabled={disabled}
            describedBy={describedBy}
            onClick={onPick}
          />
          {hiddenHelp}
        </div>
      );
    }
    return (
      <div data-setting-id={setting.id} className={row}>
        {name}
        <PickButton
          label={label}
          disabled={disabled}
          describedBy={describedBy}
          popup="dialog"
          onClick={onPick}
        >
          {picked[0] ? <DelegationOptionIcon setting={setting} value={picked[0].value} /> : null}
          <span className="min-w-0 truncate">{picked[0] ? t(picked[0].label) : labels[0]}</span>
        </PickButton>
        {hiddenHelp}
      </div>
    );
  }

  // Grids and long lists collapse to their value and open in place under the row.
  return (
    <div data-setting-id={setting.id}>
      <div className={row}>
        {name}
        <PickButton
          label={label}
          disabled={disabled}
          describedBy={describedBy}
          expanded={open}
          onClick={() => setOpen((next) => !next)}
        >
          <span className="min-w-0 truncate">{valueLabel}</span>
        </PickButton>
      </div>
      {open ? (
        <OptionGrid
          setting={setting}
          labels={labels}
          value={value}
          label={label}
          columns={
            kind === "list"
              ? "grid-cols-1"
              : settingGridColumns(labels) === 3
                ? "grid-cols-3"
                : "grid-cols-2"
          }
          disabled={disabled}
          onChoose={(next) => {
            onChoose(next);
            setOpen(false);
          }}
        />
      ) : null}
      {hiddenHelp}
    </div>
  );
}

/** Choices few enough to list inline instead of opening the column-wide picker. */
const SHORT_LIST_MAX = 3;

function OptionGrid({
  setting,
  labels,
  value,
  label,
  columns,
  disabled,
  onChoose,
}: {
  setting: ModelSetting;
  labels: string[];
  value: string;
  label: string;
  columns: "grid-cols-1" | "grid-cols-2" | "grid-cols-3";
  disabled: boolean;
  onChoose: (value: string) => void;
}) {
  return (
    <RadioGroup
      variant="tiles"
      label={label}
      value={value}
      keepFocus
      className={`grid gap-1 px-1.5 pt-1 pb-1.5 ${columns}`}
      tileClassName={`min-w-0 ${columns === "grid-cols-1" ? "justify-start" : "justify-center"}`}
      tile={{ variant: "ghost" }}
      options={setting.options.map((option, index) => ({
        value: option.value,
        tooltip: labels[index],
        content: <span className="min-w-0 truncate">{labels[index]}</span>,
      }))}
      disabled={disabled}
      onValueChange={onChoose}
    />
  );
}

function PickButton({
  label,
  disabled,
  describedBy,
  expanded,
  popup,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  describedBy?: string;
  expanded?: boolean;
  popup?: "dialog";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      type="button"
      className="max-w-[60%] min-w-0"
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      aria-expanded={expanded}
      aria-haspopup={popup}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
      <ChevronDown
        className={`icon-xs shrink-0 text-(--ui-text-secondary) ${expanded ? "rotate-180" : ""}`}
        strokeWidth={1.75}
      />
    </Button>
  );
}

const isUltraEffort = (value: string) => /^ultra/i.test(value);

/**
 * Reasoning as bars that rise with the level; the chosen level is named above them and every
 * bar names itself on hover. Levels past Max are the costly "ultra" zone and turn warm.
 */
function EffortBars({
  setting,
  labels,
  value,
  label,
  describedBy,
  disabled,
  onChoose,
}: {
  setting: ModelSetting;
  labels: string[];
  value: string;
  label: string;
  describedBy?: string;
  disabled: boolean;
  onChoose: (value: string) => void;
}) {
  const levels = ascendingEffortOptions(
    setting.options.map((option, index) => ({ value: option.value, label: labels[index] })),
  );
  const current = levels.findIndex((option) => option.value === value);
  const count = levels.length;
  const t = useT();
  return (
    <>
      <RadioGroup
        variant="tiles"
        label={label}
        aria-describedby={describedBy}
        value={value}
        keepFocus
        disabled={disabled}
        className="model-effort-bars"
        tileClassName="model-effort-bar"
        tile={{ layout: "stacked" }}
        options={levels.map((option, index) => ({
          value: option.value,
          ariaLabel: option.label,
          tooltip: option.label,
          data: {
            "data-filled": index <= current ? "" : undefined,
            "data-ultra": isUltraEffort(option.value) ? "" : undefined,
          },
          content: (
            <>
              <i style={{ height: `${30 + Math.round((index / Math.max(1, count - 1)) * 70)}%` }} />
              <span className="sr-only">{option.label}</span>
            </>
          ),
        }))}
        onValueChange={onChoose}
      />
      <div
        className="flex justify-between px-1.5 pt-1 text-ui-micro text-(--ui-text-secondary)"
        aria-hidden
      >
        <span>{t("Faster")}</span>
        <span>{t("Deeper")}</span>
      </div>
    </>
  );
}
