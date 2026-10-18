import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";

import { Select as SharedSelect, type SelectProps } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Slider as SharedSlider } from "../../../shared/ui/Slider";
import { ElasticSlider } from "../../../shared/ui/ElasticSlider";
import { Switch } from "../../../shared/ui/Switch";
import { Badge } from "../../../shared/ui/Badge";

import { playCue } from "../model/sounds";
import { useDecorativeMotionPreference } from "../model/decorativeMotion";
import { t, useLocale } from "../../../shared/i18n";

export const settingDomId = (id: string) => `setting-${id}`;

/** The row or group Settings just jumped to, so it can flash where you landed. */
export const RevealedSetting = createContext<string | null>(null);

export type SettingsSaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type SettingsPersistence = {
  mode: "automatic" | "explicit";
  /** Supplied by the owning persistence operation, never inferred from input. */
  state?: SettingsSaveState;
  error?: ReactNode;
};

type SettingDetails = {
  scope?: ReactNode;
  dependency?: ReactNode;
  persistence?: SettingsPersistence;
};

function SettingHints({ scope, dependency, persistence }: SettingDetails) {
  useLocale();
  const state = persistence?.state;
  return (
    <>
      {scope ? <p className="settings-hint">{scope}</p> : null}
      {dependency ? <p className="settings-hint">{dependency}</p> : null}
      {persistence ? (
        <div className="settings-hint">
          <span>
            {t(
              persistence.mode === "automatic"
                ? "Changes save automatically"
                : "Changes require saving",
            )}
          </span>
          {state && state !== "idle" ? (
            <Badge
              tone={
                state === "error"
                  ? "danger"
                  : state === "saved"
                    ? "success"
                    : state === "saving"
                      ? "info"
                      : "warning"
              }
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {state === "dirty" ? ` · ${t("Unsaved changes")}` : null}
              {state === "saving" ? ` · ${t("Saving…")}` : null}
              {state === "saved" ? ` · ${t("Saved")}` : null}
              {state === "error" ? (
                <>
                  {" · "}
                  {persistence.error ?? t("Could not save changes")}
                </>
              ) : null}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Append descriptions to native and custom controls without replacing caller ARIA. */
function useControlDescriptions(descriptionId: string | undefined) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!descriptionId || !root.current) return;
    const container = root.current;
    const controls = new Set<HTMLElement>();
    const associate = () => {
      container
        .querySelectorAll<HTMLElement>("input, select, textarea, button, [role='radiogroup']")
        .forEach((control) => {
          const ids = new Set(
            control.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean),
          );
          if (!ids.has(descriptionId)) {
            ids.add(descriptionId);
            control.setAttribute("aria-describedby", [...ids].join(" "));
          }
          controls.add(control);
        });
    };
    associate();
    const observer = new MutationObserver(associate);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-describedby"],
    });
    return () => {
      observer.disconnect();
      controls.forEach((control) => {
        const ids =
          control
            .getAttribute("aria-describedby")
            ?.split(/\s+/)
            .filter((id) => id && id !== descriptionId) ?? [];
        if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
        else control.removeAttribute("aria-describedby");
      });
    };
  }, [descriptionId]);
  return root;
}

/** Settings stay visible, including advanced controls. Search can focus the group. */
export function AdvancedSettings({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id?: string;
  settingIds?: readonly string[];
  title?: ReactNode;
  defaultOpen?: boolean;
}) {
  useLocale();
  const headingId = useId();
  return (
    <section
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      className="settings-advanced"
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <h3 id={headingId} className="settings-subheading">
        {title ?? t("Advanced")}
      </h3>
      {children}
    </section>
  );
}

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="pb-4">
      <h1 className="text-[20px] font-semibold leading-tight text-content">{title}</h1>
      {description ? (
        <p className="settings-description mt-1.5 max-w-xl text-[13px] leading-relaxed text-content/65">
          {description}
        </p>
      ) : null}
    </header>
  );
}

/**
 * A titled card of related settings. Everything on a page lives in one, so a
 * page reads as a handful of topics instead of one long list of switches.
 */
export function Group({
  id,
  title,
  description,
  action,
  layout = "columns",
  scope,
  dependency,
  persistence,
  children,
}: {
  /** Matches a `SETTINGS_INDEX` id when the whole card is the search target. */
  id?: string;
  title: ReactNode;
  description?: string;
  action?: ReactNode;
  layout?: "columns" | "full";
  children: ReactNode;
} & SettingDetails) {
  const revealed = useContext(RevealedSetting);
  const flash = id != null && revealed === id;
  const headingId = useId();
  const descriptionId = useId();
  const hasDescription = Boolean(description || scope || dependency || persistence);
  const controls = useControlDescriptions(hasDescription ? descriptionId : undefined);

  return (
    <section
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-revealed={flash || undefined}
      data-settings-layout={layout}
      tabIndex={-1}
      aria-labelledby={headingId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      className="settings-group pt-8 first:pt-0"
    >
      <div className="settings-group-heading flex flex-wrap items-start gap-4 pb-2.5">
        <div className="settings-group-title min-w-0 flex-1">
          <h2 id={headingId} className="text-[13px] font-semibold text-content">
            {title}
          </h2>
          <div id={descriptionId}>
            {description ? (
              <p className="settings-description mt-1 text-[12px] leading-relaxed text-content/65">
                {description}
              </p>
            ) : null}
            <SettingHints scope={scope} dependency={dependency} persistence={persistence} />
          </div>
        </div>
        {action ? <div className="shrink-0 pb-0.5">{action}</div> : null}
      </div>
      <div
        ref={controls}
        className={`settings-group-content overflow-hidden rounded-xl border bg-content/3 transition-colors ${
          flash ? "border-accent/60" : "border-content/10"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

export function Row({
  id,
  label,
  description,
  scope,
  dependency,
  persistence,
  controlId,
  children,
}: {
  /** Matches a `SETTINGS_INDEX` id so search can scroll here. */
  id?: string;
  label: ReactNode;
  description?: string;
  children?: ReactNode;
  /** Optional native control id for a clickable label. */
  controlId?: string;
} & SettingDetails) {
  const revealed = useContext(RevealedSetting);
  const flash = id != null && revealed === id;
  const labelId = useId();
  const descriptionId = useId();
  const hasDescription = Boolean(description || scope || dependency || persistence);
  const controls = useControlDescriptions(hasDescription ? descriptionId : undefined);

  return (
    <div
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-revealed={flash || undefined}
      tabIndex={-1}
      className={`settings-row flex items-start gap-6 border-b border-content/5 px-4 py-3.5 transition-colors last:border-b-0 ${
        flash ? "bg-accent/10" : ""
      }`}
    >
      <div className="settings-row-label min-w-0 flex-1">
        {controlId ? (
          <label id={labelId} htmlFor={controlId} className="text-[13px] font-medium text-content">
            {label}
          </label>
        ) : (
          <div id={labelId} className="text-[13px] font-medium text-content">
            {label}
          </div>
        )}
        <div id={descriptionId}>
          {description ? (
            <p className="settings-description mt-1 text-[12px] leading-relaxed text-content/65">
              {description}
            </p>
          ) : null}
          <SettingHints scope={scope} dependency={dependency} persistence={persistence} />
        </div>
      </div>
      <div
        ref={controls}
        role={children ? "group" : undefined}
        aria-labelledby={children ? labelId : undefined}
        aria-describedby={hasDescription ? descriptionId : undefined}
        className="settings-row-control flex min-w-0 max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-2"
      >
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  optionIdPrefix,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  optionIdPrefix?: string;
}) {
  return (
    <SegmentedControl
      label={label}
      value={value}
      options={options}
      onValueChange={(next) => {
        const selected = options.find((option) => option.value === next);
        if (selected) onChange(selected.value);
      }}
      selectionRole="radio"
      optionIdPrefix={optionIdPrefix}
    />
  );
}

export function Slider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  feel = "standard",
  onValueCommit,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  feel?: "standard" | "elastic";
  onValueCommit?: (value: number) => void;
}) {
  const Control = feel === "elastic" ? ElasticSlider : SharedSlider;
  const decorativeMotion = useDecorativeMotionPreference();
  return (
    <div className="flex w-56 max-w-full items-center gap-3">
      <Control
        {...(feel === "elastic"
          ? { motion: decorativeMotion ? ("auto" as const) : ("none" as const) }
          : {})}
        label={label}
        hideLabel
        showValue={false}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="min-w-0 flex-1"
        format={() => display}
        onValueChange={onChange}
        onValueCommit={onValueCommit}
      />
      <span
        className={`w-10 shrink-0 text-right text-[12px] text-content tabular-nums ${disabled ? "opacity-40" : ""}`}
      >
        {display}
      </span>
    </div>
  );
}

export function Toggle({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      type="button"
      aria-label={label}
      checked={on}
      compact
      disabled={disabled}
      onCheckedChange={(next) => {
        onChange(next);
        playCue("switch");
      }}
      className="settings-toggle shrink-0"
    />
  );
}

/** Settings compatibility facade; shared UI owns the choice interaction. */
export function Select({
  onChange,
  ...props
}: Omit<SelectProps, "onValueChange"> & {
  onChange: (value: string) => void;
}) {
  return <SharedSelect {...props} onValueChange={onChange} />;
}
