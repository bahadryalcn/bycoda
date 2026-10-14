import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { ChevronDown, CircleHelp, SlidersHorizontal } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  defaultModelSettings,
  getModelSnapshot,
  mergeModelSettings,
  subscribeModels,
} from "../model/models";
import { offeredDelegationSetting } from "../model/claudeAdvisor";
import { pickerSettings } from "../model/modelPickerData";
import type { ModelSetting } from "../model/models";
import type { HarnessId } from "../model/session";
import { HARNESS_TITLE } from "../model/session";
import { useModelSource } from "./modelSource";

const DELEGATION = new Set(["advisor", "subagentModel", "subagentPolicy"]);
const COMPACTION = new Set(["autoCompact", "autoCompactWindow"]);
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
  const delegated = settings.filter((s) => DELEGATION.has(s.id));
  const compaction = settings.filter((s) => COMPACTION.has(s.id));
  const own = settings.filter((s) => !DELEGATION.has(s.id) && !COMPACTION.has(s.id));
  const groups: Array<{ title?: string; settings: ModelSetting[] }> =
    own.length < settings.length
      ? [
          { title: "Model", settings: own },
          { title: "Context", settings: compaction },
          { title: "Advisor and subagents", settings: delegated },
        ].filter((group) => group.settings.length > 0)
      : [{ settings }];
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
  useLocale();
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
    const label = t(setting.label);
    const update = (next: string) => {
      if (!disabled) onSettingsChange({ ...effective, [setting.id]: next });
    };
    return (
      <div
        key={setting.id}
        className={dependent ? "ml-2 border-l border-stroke pl-2.5" : undefined}
      >
        <div className="flex min-h-8 items-center gap-2 text-[12px]">
          <span
            className={`flex min-w-0 flex-1 items-center gap-1 ${inactive ? "text-content/45" : ""}`}
          >
            <span className="min-w-0 leading-4 break-words">{label}</span>
            {modified && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-content/70"
                title={t("Changed from default")}
              />
            )}
            {setting.description && (
              <button
                type="button"
                aria-label={t("About {p0}", { p0: label })}
                aria-expanded={showHelp}
                aria-controls={descriptionId}
                onClick={() => setExplained(showHelp ? null : setting.id)}
                className={`shrink-0 rounded p-0.5 hover:text-content ${showHelp ? "text-content" : "text-content/40"}`}
              >
                <CircleHelp className="size-3" />
              </button>
            )}
          </span>
          {setting.kind === "toggle" ? (
            <span className="relative inline-flex shrink-0">
              <input
                type="checkbox"
                role="switch"
                aria-label={label}
                aria-describedby={setting.description ? descriptionId : undefined}
                checked={value === "true"}
                disabled={disabled || inactive}
                onChange={(e) => update(String(e.target.checked))}
                className="peer absolute inset-0 z-[1] m-0 cursor-pointer opacity-0 disabled:cursor-default"
              />
              <span
                aria-hidden
                className="h-4 w-7 rounded-full bg-content/20 transition-colors peer-checked:bg-active peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-disabled:opacity-40"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute top-0.5 left-0.5 size-3 rounded-full bg-background-base shadow transition-transform peer-checked:translate-x-3"
              />
            </span>
          ) : (
            <select
              aria-label={label}
              aria-describedby={setting.description ? descriptionId : undefined}
              value={value}
              disabled={disabled || inactive}
              onChange={(e) => update(e.target.value)}
              className="h-7 w-[52%] max-w-[11.5rem] min-w-0 shrink-0 truncate rounded-md border border-stroke bg-background-base px-1.5 text-[11px] text-content disabled:opacity-40"
            >
              {setting.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          )}
        </div>
        {setting.description && (
          <p
            id={descriptionId}
            hidden={!showHelp}
            className="mb-1 rounded-md bg-selection/60 px-2 py-1.5 text-[10.5px] leading-4 text-content/60"
          >
            {t(setting.description)}
          </p>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-stroke bg-background-base/80 px-3 backdrop-blur-xl pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          {leading}
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
            {title ?? `${HARNESS_TITLE[harness]} · ${t("Extras")}`}
          </span>
          <button
            type="button"
            disabled={disabled || changed === 0}
            onClick={() => {
              if (!disabled) onSettingsChange(defaultModelSettings(current));
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-content/60 hover:bg-selection hover:text-content disabled:pointer-events-none disabled:opacity-40"
          >
            {t("Reset extras")}
          </button>
        </div>
        <p className="mt-0.5 text-[10.5px] leading-4 text-content/50">
          {t("Extras apply to this model selection. They do not change the main model.")}
        </p>
      </div>
      <div className="space-y-3 px-3 pt-2 pb-3">
        {groups.map((group) => (
          <section key={group.title ?? "all"}>
            {group.title && (
              <h3 className="mb-1 text-[10px] font-medium tracking-wide text-content/45 uppercase">
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
  useLocale();
  const { settings, effective, active, changed } = useModelExtras(harness, model, values);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [harness, model, disabled]);
  if (!settings.length) return null;
  const dismiss = () => {
    setOpen(false);
    anchor.current?.focus();
    onClose?.();
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-model-control
        aria-label={t("Extras")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-extras-trigger
        className="flex h-6.5 shrink-0 items-center gap-1 rounded-md bg-selection px-1.5 text-[11px] text-content hover:bg-selection-hover focus-visible:outline focus-visible:outline-1 disabled:opacity-40"
      >
        <SlidersHorizontal className="size-3 shrink-0" strokeWidth={1.75} />
        <span data-extras-label>{t("Extras")}</span>
        {changed > 0 && (
          <span className="rounded bg-selection px-1 text-[10px] text-content">{changed}</span>
        )}
        {showSummary && changed > 0 && (
          <span data-extras-summary className="max-w-40 truncate text-content/50">
            {active
              .map((s) =>
                t(s.options.find((o) => o.value === effective[s.id])?.label ?? effective[s.id]),
              )
              .join(" · ")}
          </span>
        )}
        <ChevronDown className="size-3" />
      </button>
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
