import { EffortScale } from "../../../shared/ui/EffortScale";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import {
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Switch } from "../../../shared/ui/Switch";
import { Slider } from "../../../shared/ui/Slider";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { ChevronDown, Plus, X, Zap } from "../../../shared/ui/icons";
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
import { SubagentModeControl } from "./SubagentModeControl";
import { subagentMode } from "../model/crossDelegation";
import { ModelSettingPicker } from "./ModelSettingPicker";
import { SubagentEffortSwitch } from "./SubagentEffortSwitch";
import {
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  subagentEffortCeiling,
} from "../../../shared/model/host-contracts/delegation";

const isUltraEffort = (value: string) => /^ultra/i.test(value);

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
export function ModelSettingHelp({
  setting,
  settings = [],
  trailing,
}: {
  setting: ModelSetting | null;
  /** All descriptions remain available without hovering another control. */
  settings?: ModelSetting[];
  /** Trailing action, e.g. a link to the provider settings. */
  trailing?: ReactNode;
}) {
  const t = useT();
  const help = setting ? helpText(setting) : undefined;
  const descriptions = (settings.length ? settings : setting ? [setting] : []).filter((item) =>
    helpText(item),
  );
  return (
    <div
      data-model-setting-help
      {...surfaceAttributes(
        { frame: "frosted", edge: "top" },
        "flex shrink-0 items-center gap-2 px-3 py-1 ui-caption-text",
      )}
    >
      <ClampText as="p" lines={1} expandable={false} className="min-w-0 flex-1">
        {setting && help ? (
          <>
            <Text size="inherit" tone="neutral" weight="medium">
              {t(settingLabel(setting))}
            </Text>{" "}
            {t(help)}
          </>
        ) : (
          t("Help")
        )}
      </ClampText>
      {descriptions.length ? (
        <InfoPopover label={t("Help")}>
          {descriptions.map((item) => (
            <Text as="p" key={item.id} size="secondary" leading="relaxed">
              <Text size="inherit" weight="medium">
                {t(settingLabel(item))}
              </Text>{" "}
              {t(helpText(item)!)}
            </Text>
          ))}
        </InfoPopover>
      ) : null}
      {trailing ? <span className="ml-auto flex shrink-0">{trailing}</span> : null}
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
  const column = useRef<HTMLDivElement>(null);
  const returnSetting = useRef<string | null>(null);
  const focusedSetting = useRef<ModelSetting | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync DOM focus with the remounted setting after its column picker closes.
  useLayoutEffect(() => {
    if (pickingId || !returnSetting.current) return;
    const row = column.current?.querySelector<HTMLElement>(
      `[data-setting-id="${returnSetting.current}"]`,
    );
    returnSetting.current = null;
    (
      row?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      row?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])")
    )?.focus({ preventScroll: true });
  }, [pickingId]);
  const shownTab: PanelTab = agents.length === 0 ? "settings" : model.length === 0 ? "agents" : tab;
  const shown = shownTab === "settings" ? model : agents;
  const setExplained = (next: ModelSetting | null) => {
    setExplainedId(next?.id ?? null);
    onExplain(next);
  };
  const picking = shown.find((setting) => setting.id === pickingId);
  const pinned = shown.filter(
    (setting) => shownTab === "settings" && settingControlKind(setting) === "effort",
  );
  const scrolling = shown.filter((setting) => !pinned.includes(setting));
  const renderSetting = (setting: ModelSetting) => (
    <SettingRow
      key={setting.id}
      setting={setting}
      values={values}
      disabled={locked(setting)}
      onChoose={(value) => onChoose(setting, value)}
      onPick={() => {
        returnSetting.current = setting.id;
        setPickingId(setting.id);
      }}
    />
  );
  // Hover or focus names the setting whose help the strip shows.
  const explain = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-setting-id]")?.dataset
      .settingId;
    const next = shown.find((setting) => setting.id === (id ?? pickingId)) ?? null;
    if (event.type === "focus") focusedSetting.current = next;
    const explained = focusedSetting.current ?? next;
    if ((explained?.id ?? null) !== explainedId) setExplained(explained);
  };

  return (
    <div
      ref={column}
      data-model-settings
      onFocus={explain}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusedSetting.current = null;
          setExplained(null);
        }
      }}
      {...surfaceAttributes(
        { frame: "neutral", edge: "responsive-start" },
        "flex min-h-0 min-w-0 flex-1 flex-col @max-[32rem]/model-panel:min-h-60 @max-[32rem]/model-panel:w-full @max-[32rem]/model-panel:shrink-0 @max-[32rem]/model-panel:[--surface-frame-stacked:1]",
      )}
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
          panels="none"
        >
          <TabList label={t("Model options")} className="shrink-0 px-2 pt-1.5">
            <Tab value="settings">{t("Settings")}</Tab>
            <Tab value="agents">{t("Agents")}</Tab>
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
        <>
          {pinned.length ? (
            <div
              className="shrink-0 px-1.5"
              onMouseOver={explain}
              onMouseLeave={() => setExplained(focusedSetting.current)}
            >
              {pinned.map(renderSetting)}
            </div>
          ) : null}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 pt-1 pb-2"
            onMouseOver={explain}
            onMouseLeave={() => setExplained(focusedSetting.current)}
          >
            {shown.length === 0 ? (
              <p className="px-1.5 py-2 ui-caption-text">
                {t("{p0} has no extra options.", { p0: HARNESS_TITLE[current.harness] })}
              </p>
            ) : (
              scrolling.map(renderSetting)
            )}
          </div>
        </>
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
  const { formatNumber } = useFormat();
  const [open, setOpen] = useState(false);
  const labels = setting.options.map((option) => t(option.label));
  const kind = settingControlKind(setting, labels);
  const label = t(settingLabel(setting));
  const isCeiling = setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY;
  const rawValue = settingValue(setting, values);
  const value = isCeiling ? subagentEffortCeiling(rawValue) : rawValue;
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
  const name = (
    <Text as="span" size="caption" tone="inherit" weight="medium" truncate className="min-w-0">
      {label}
    </Text>
  );
  const heading = (trailing: ReactNode) => (
    <div className="flex items-center justify-between gap-2 px-1.5 pt-2 pb-1.5">
      <Text as="span" size="caption" weight="medium" tone="secondary" className="min-w-0">
        <span className="inline-flex items-center gap-1">
          {label}
          {help ? <InfoPopover label={label}>{t(help)}</InfoPopover> : null}
        </span>
      </Text>
      {trailing}
    </div>
  );

  if (kind === "slider") {
    const thresholds = setting.options
      .map((option) => Number(option.value))
      .filter((tokens) => tokens > 0);
    const minimum = Math.min(...thresholds) - 50_000;
    const maximum = Math.max(...thresholds);
    const tokens = Number(value) || minimum;
    const format = (next: number) =>
      next === minimum
        ? t("Default")
        : (setting.options.find((option) => Number(option.value) === next)?.label ??
          formatNumber(next));
    return (
      <div data-setting-id={setting.id} className="px-1.5 py-2">
        <Slider
          label={label}
          value={tokens}
          min={minimum}
          max={maximum}
          step={50_000}
          largeStep={50_000}
          format={format}
          disabled={disabled}
          onValueChange={(next) => onChoose(next === minimum ? "default" : String(next))}
        />
        {hiddenHelp}
      </div>
    );
  }

  if (kind === "toggle") {
    return (
      <div data-setting-id={setting.id} className={row}>
        <span className="flex min-w-0 items-center gap-1.5">
          {setting.id === "fast" ? (
            <Zap className="icon-xs shrink-0" tone="secondary" strokeWidth={1.75} aria-hidden />
          ) : null}
          {name}
        </span>
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
          isCeiling ? null : (
            <Text
              as="span"
              size="caption"
              weight="medium"
              tone={isUltraEffort(value) ? "warning" : "inherit"}
            >
              {valueLabel}
            </Text>
          ),
        )}
        {isCeiling ? (
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <Text as="span" size="caption" tone="secondary">
              {value ? valueLabel : t("No limit")}
            </Text>
            <SubagentEffortSwitch value={value} disabled={disabled} onChange={onChoose} />
          </div>
        ) : null}
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
      (option) =>
        option.value &&
        option.value !== "auto" &&
        delegationOptionSelected(setting, values, option.value),
    );
    if (isMultiSetting(setting)) {
      // Subagents pick a mode first: Automatic, a custom list or Off. Custom opens the picker.
      const subagents = isSubagentSetting(setting);
      const mode = subagentMode(value);
      // Picked models share rows so identities and removal actions remain comparable.
      // The column owns scrolling so model lists and effort keep their reading order.
      return (
        <div data-setting-id={setting.id} className="flex min-h-0 shrink-0 flex-col pb-1">
          {heading(
            picked.length || !subagents ? (
              <Text size="caption" tone="secondary">
                {picked.length ? formatNumber(picked.length) : t("Automatic")}
              </Text>
            ) : null,
          )}
          {subagents ? (
            <div className="px-1.5 pb-1.5">
              <SubagentModeControl
                label={label}
                value={value}
                disabled={disabled}
                onCustom={onPick}
                onChange={(next) => onChoose(next === "[]" ? "" : next)}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1 px-1.5" role="group" aria-label={label}>
            {picked.map((option) => (
              <Text
                as="span"
                key={option.value}
                size="caption"
                tone="neutral"
                {...surfaceAttributes(
                  { frame: "neutral", edge: "bottom" },
                  "flex min-w-0 items-center gap-2 py-0.5 ps-1 pe-0.5",
                )}
              >
                <DelegationOptionIcon setting={setting} value={option.value} />
                <ClampText as="span" lines={2} expandable={false} className="min-w-0 flex-1">
                  {delegationShortLabel(setting, option.value, t(option.label))}
                </ClampText>
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
              </Text>
            ))}
            {subagents && mode !== "custom" ? null : (
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
            )}
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
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {picked[0] ? t(picked[0].label) : labels[0]}
          </Text>
        </PickButton>
        {hiddenHelp}
      </div>
    );
  }

  if (kind === "grid") {
    // A handful of choices stay visible under the setting's name, like Reasoning: nothing to open.
    return (
      <div data-setting-id={setting.id} className="pb-1">
        {heading(null)}
        <OptionGrid
          setting={setting}
          labels={labels}
          value={value}
          label={label}
          columns={GRID_COLUMNS[settingGridColumns(labels)]}
          disabled={disabled}
          onChoose={onChoose}
        />
        {hiddenHelp}
      </div>
    );
  }

  // A long list collapses to its value and opens in place under the row.
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
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {valueLabel}
          </Text>
        </PickButton>
      </div>
      {open ? (
        <OptionGrid
          setting={setting}
          labels={labels}
          value={value}
          label={label}
          columns="grid-cols-1"
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

/** Content-sized columns: a long label takes the room it needs and the row still fills the column. */
const GRID_COLUMNS = {
  2: "grid-cols-[repeat(2,minmax(0,auto))]",
  3: "grid-cols-[repeat(3,minmax(0,auto))]",
  4: "grid-cols-[repeat(4,minmax(0,auto))]",
} as const;

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
  columns: "grid-cols-1" | (typeof GRID_COLUMNS)[keyof typeof GRID_COLUMNS];
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
        content: (
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {labels[index]}
          </Text>
        ),
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
        className={`icon-xs shrink-0 ${expanded ? "rotate-180" : ""}`}
        tone="secondary"
        strokeWidth={1.75}
      />
    </Button>
  );
}

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
    setting.options
      .map((option, index) => ({ value: option.value, label: labels[index] }))
      .filter((option) => setting.id !== CROSS_SUBAGENT_MAX_EFFORT_KEY || Boolean(option.value)),
  );
  return (
    <EffortScale
      options={levels}
      value={value}
      label={label}
      describedBy={describedBy}
      disabled={disabled}
      keepFocus
      showValue={false}
      onValueChange={onChoose}
    />
  );
}
