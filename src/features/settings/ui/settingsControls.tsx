import { Check, ChevronDown } from "../../../shared/ui/icons";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { Popover } from "../../../shared/ui/Popover";
import { SelectTrigger, SelectOption, SelectValue } from "../../../shared/ui/arc/select/select";
import SegmentedControl from "../../../shared/ui/arc/segmented-control/segmented-control";
import { Slider as ArcSlider } from "../../../shared/ui/arc/slider/slider";
import { Switch as ArcSwitch } from "../../../shared/ui/arc/switch/switch";

import { playCue } from "../model/sounds";
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
            {t(persistence.mode === "automatic"
              ? "Changes save automatically"
              : "Changes require saving")}
          </span>
          <span role="status" aria-live="polite" aria-atomic="true">
            {state === "dirty" ? ` · ${t("Unsaved changes")}` : null}
            {state === "saving" ? ` · ${t("Saving…")}` : null}
            {state === "saved" ? ` · ${t("Saved")}` : null}
            {state === "error" ? (
              <>{" · "}{persistence.error ?? t("Could not save changes")}</>
            ) : null}
          </span>
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
      container.querySelectorAll<HTMLElement>("input, select, textarea, button, [role='radiogroup']").forEach((control) => {
        const ids = new Set(control.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean));
        if (!ids.has(descriptionId)) {
          ids.add(descriptionId);
          control.setAttribute("aria-describedby", [...ids].join(" "));
        }
        controls.add(control);
      });
    };
    associate();
    const observer = new MutationObserver(associate);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-describedby"] });
    return () => {
      observer.disconnect();
      controls.forEach((control) => {
        const ids = control.getAttribute("aria-describedby")?.split(/\s+/).filter((id) => id && id !== descriptionId) ?? [];
        if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
        else control.removeAttribute("aria-describedby");
      });
    };
  }, [descriptionId]);
  return root;
}

/** Search may open this disclosure; it stays open after the highlight expires. */
export function AdvancedSettings({
  children,
  id,
  settingIds = [],
  title,
  defaultOpen = false,
}: {
  children: ReactNode;
  id?: string;
  settingIds?: readonly string[];
  title?: ReactNode;
  defaultOpen?: boolean;
}) {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const [open, setOpen] = useState(defaultOpen);
  const target = revealed != null && settingIds.includes(revealed);
  useEffect(() => {
    if (target) setOpen(true);
  }, [target]);
  return (
    <details
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      className="settings-advanced"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title ?? t("Advanced")}</summary>
      {children}
    </details>
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
          <h2 id={headingId} className="text-[13px] font-semibold text-content">{title}</h2>
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
        {controlId ? <label id={labelId} htmlFor={controlId} className="text-[13px] font-medium text-content">{label}</label> : <div id={labelId} className="text-[13px] font-medium text-content">{label}</div>}
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
      className="bycoda-arc bycoda-arc-segmented"
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
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-56 max-w-full items-center gap-3">
      <ArcSlider
        label={label}
        hideLabel
        showValue={false}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="bycoda-arc bycoda-arc-slider min-w-0 flex-1"
        format={() => display}
        onValueChange={onChange}
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
    <ArcSwitch
      type="button"
      aria-label={label}
      checked={on}
      compact
      disabled={disabled}
      onCheckedChange={(next) => {
        onChange(next);
        playCue("switch");
      }}
      className="bycoda-arc bycoda-arc-switch settings-toggle shrink-0"
    />
  );
}

/** Theme-aware dropdown for a Settings row: a trigger button opening a Popover listbox. Used instead of a native select, whose option popup is OS-rendered and unreadable in dark mode on Windows/Linux. */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  onOpen,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const activeId = options[active] != null ? `${listId}-opt-${active}` : undefined;

  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }, [open, value, options]);

  useEffect(() => {
    if (!open) return;
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options[active];
      if (option) pick(option.value);
    }
  };

  return (
    <div ref={root} className="relative max-w-52">
      <SelectTrigger
        type="button"
        ref={trigger}
        data-state={open ? "open" : "closed"}
        data-disabled={disabled || undefined}
        disabled={disabled}
        aria-label={`${label}: ${selected?.label ?? value}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!open) onOpen?.();
          setOpen(true);
        }}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className="settings-select flex min-h-8 w-full items-center justify-between gap-2 rounded-[3px] border border-content/15 bg-content/5 px-2.5 py-1.5 text-left text-[12px] text-content hover:border-content/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {selected?.icon ? (
            <span className="grid size-4 shrink-0 place-items-center">{selected.icon}</span>
          ) : null}
          <SelectValue value={value} label={selected ? selected.label : value} />
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-content/50 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </SelectTrigger>
      {open ? (
        <Popover
          id={listId}
          anchor={root}
          side="bottom"
          align="end"
          width={280}
          maxHeight={320}
          autoFocus
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") trigger.current?.focus();
          }}
          role="listbox"
          aria-label={label}
          aria-activedescendant={activeId}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className="bycoda-arc bycoda-arc-menu overflow-y-auto overscroll-contain p-1"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const highlighted = index === active;
            return (
              <SelectOption
                key={option.value}
                ref={highlighted ? activeOption : undefined}
                type="button"
                id={`${listId}-opt-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                data-highlighted={highlighted || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option.value)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] ${
                  highlighted || isSelected
                    ? "bg-selection text-content"
                    : "text-content hover:bg-content/5"
                }`}
              >
                {option.icon ? (
                  <span className="grid size-4 shrink-0 place-items-center">{option.icon}</span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? <Check className="size-3.5 shrink-0" strokeWidth={2.25} /> : null}
              </SelectOption>
            );
          })}
        </Popover>
      ) : null}
    </div>
  );
}
