import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { Select as SharedSelect, type SelectProps } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Slider as SharedSlider } from "../../../shared/ui/Slider";
import { ElasticSlider } from "../../../shared/ui/ElasticSlider";
import { Switch } from "../../../shared/ui/Switch";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { ChevronRight, RotateCcw } from "../../../shared/ui/icons";

import { playCue } from "../model/sounds";
import { useDecorativeMotionPreference } from "../model/decorativeMotion";
import { t, useLocale } from "../../../shared/i18n";

// Reusable settings rows also appear in feature dialogs before SettingsView loads.
import "./BycodaSettings.css";

export const settingDomId = (id: string) => `setting-${id}`;

/** The row or group Settings just jumped to, so it can flash where you landed. */
export const RevealedSetting = createContext<string | null>(null);

/** The page already explains automatic saving; keep operation feedback local. */
export const PageAutomaticSaveHint = createContext(false);

/**
 * Page-level "Restore defaults". A page opts in by calling `useSettingsPageReset(handler)`;
 * the settings shell then shows one header action behind a confirmation. Pages that do not
 * call it show nothing. The handler restores only that page's settings.
 */
export type SettingsPageResetRegistration = { run: () => void | Promise<void> };
export const SettingsPageResetRegistry = createContext<Dispatch<
  SetStateAction<SettingsPageResetRegistration | null>
> | null>(null);

/** Register (non-null) or withdraw (null) this page's reset handler for the shell header. */
export function useSettingsPageReset(onReset: (() => void | Promise<void>) | null) {
  const register = useContext(SettingsPageResetRegistry);
  const latest = useRef(onReset);
  useEffect(() => {
    latest.current = onReset;
  });
  const enabled = onReset != null;
  useEffect(() => {
    if (!register || !enabled) return;
    register({ run: () => latest.current?.() });
    return () => register(null);
  }, [register, enabled]);
}

/**
 * Small reset icon shown next to a title only while a setting differs from its default.
 * Rows and groups render it from `modified` + `onReset`; use it directly for custom headers.
 */
export function SettingResetButton({
  onReset,
  label,
}: {
  onReset: () => void;
  /** Accessible name and tooltip. Defaults to "Restore default". */
  label?: string;
}) {
  useLocale();
  const name = label ?? t("Restore default");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      label={name}
      tooltip={name}
      className="settings-reset shrink-0"
      onClick={onReset}
    >
      <RotateCcw aria-hidden className="icon-xs" strokeWidth={1.75} />
    </Button>
  );
}

export type SettingsSaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type SettingsPersistence = {
  mode: "automatic" | "explicit";
  /** Supplied by the owning persistence operation, never inferred from input. */
  state?: SettingsSaveState;
  error?: ReactNode;
};

/** Optional per-row/per-group reset affordance: shown only while `modified` is true. */
type SettingReset = {
  /** True when the current value differs from the default. */
  modified?: boolean;
  /** Restores this row's (or group's) default. The reset icon renders only with `modified`. */
  onReset?: () => void;
  /** Accessible name and tooltip of the reset icon. Defaults to "Restore default". */
  resetLabel?: string;
};

type SettingDetails = {
  scope?: ReactNode;
  dependency?: ReactNode;
  persistence?: SettingsPersistence;
  /** Operation feedback occupies its own line below the associated controls. */
  feedback?: ReactNode;
};

export function SettingsFeedback({
  state,
  children,
  action,
  presentation = "quiet",
}: {
  state: "loading" | "success" | "error" | "empty" | "warning";
  children: ReactNode;
  action?: ReactNode;
  /**
   * `quiet` (default): one inline line, tone glyph plus neutral text and the recovery action,
   * with no fill or border. Role and live-region semantics are unchanged, so errors stay
   * announced and visible. `surface`: the filled, bordered notice for blocking states.
   * `inset`: quiet empty information inside an already framed Group (errors still use Alert).
   */
  presentation?: "quiet" | "surface" | "inset";
}) {
  return (
    <div className="settings-feedback" data-state={state} data-presentation={presentation}>
      {state === "empty" && presentation === "inset" ? (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-ui-caption text-(--ui-text-secondary)"
        >
          {children}
        </div>
      ) : (
        <Alert
          tone={
            state === "error"
              ? "danger"
              : state === "warning"
                ? "warning"
                : state === "success"
                  ? "success"
                  : "info"
          }
          role={state === "error" ? "alert" : "status"}
          aria-live={state === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          inline={presentation !== "surface"}
          action={action}
        >
          {children}
        </Alert>
      )}
      {state === "empty" && presentation === "inset" ? action : null}
    </div>
  );
}

/** Essential scope and dependencies stay visible beside the setting. */
function SettingContext({
  scope,
  dependency,
}: Pick<SettingDetails, "scope" | "dependency">) {
  return (
    <>
      {scope ? <div className="settings-description settings-scope">{scope}</div> : null}
      {dependency ? (
        <div className="settings-description settings-dependency">{dependency}</div>
      ) : null}
    </>
  );
}

/** Visible persistence state only: errors, unsaved/saving/saved and explicit-save guidance. */
function SettingStatus({ persistence }: Pick<SettingDetails, "persistence">) {
  useLocale();
  const state = persistence?.state;
  const showSaveHint = persistence?.mode === "explicit";
  if (!persistence || !(showSaveHint || (state && state !== "idle"))) return null;
  return (
    <div className="settings-hint">
      {showSaveHint ? <span>{t("Changes require saving")}</span> : null}
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
          {state === "dirty" ? t("Unsaved changes") : null}
          {state === "saving" ? t("Saving…") : null}
          {state === "saved" ? t("Saved") : null}
          {state === "error" ? (persistence.error ?? t("Could not save changes")) : null}
        </Badge>
      ) : null}
    </div>
  );
}

/** Screen-reader description for a group or row; the automatic-save note lives here, not on screen. */
function SettingDescriptionText({ persistence }: Pick<SettingDetails, "persistence">) {
  useLocale();
  const pageExplainsSaving = useContext(PageAutomaticSaveHint);
  return persistence?.mode === "automatic" && !pageExplainsSaving ? (
    <span className="sr-only">{t("Changes save automatically")}</span>
  ) : null;
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

/**
 * Secondary settings as one disclosure row: the title sits on the same x as row titles, the
 * chevron on the right, and a hairline separates it from the rows above. Put it last in a Group.
 * Opens by default for compatibility; new pages pass `defaultOpen={false}` so Advanced is closed.
 * A search/reveal landing on this section or one of its `settingIds` opens it. Keep children to
 * Rows; never use it to hold only a paragraph (use `info` on the related row instead).
 */
export function AdvancedSettings({
  children,
  id,
  settingIds,
  title,
  defaultOpen = true,
}: {
  children: ReactNode;
  id?: string;
  settingIds?: readonly string[];
  title?: ReactNode;
  defaultOpen?: boolean;
}) {
  useLocale();
  const headingId = useId();
  const revealed = useContext(RevealedSetting);
  const targeted = revealed != null && (revealed === id || !!settingIds?.includes(revealed));
  const [open, setOpen] = useState(defaultOpen || targeted);
  const [wasTargeted, setWasTargeted] = useState(targeted);
  if (targeted !== wasTargeted) {
    setWasTargeted(targeted);
    if (targeted) setOpen(true);
  }
  return (
    <section
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-open={open || undefined}
      className="settings-advanced"
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <h3 id={headingId} className="settings-subheading">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          align="start"
          fullWidth
          motion="none"
          className="settings-advanced-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight
            aria-hidden
            className="icon-xs"
            strokeWidth={1.75}
            data-open={open || undefined}
          />
          {title ?? t("Advanced")}
        </Button>
      </h3>
      {open ? children : null}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  automaticSave = false,
}: {
  title: string;
  description: string;
  /** The page saves every change itself; say so once, here, instead of on every group. */
  automaticSave?: boolean;
}) {
  return (
    <header className="settings-page-header">
      <h1 className="settings-page-title">{title}</h1>
      <SettingsPageHelp description={description} automaticSave={automaticSave} />
    </header>
  );
}

/** Shared page help moves into the category toolbar on narrow settings layouts. */
export function SettingsPageHelp({
  description,
  automaticSave = false,
  className = "",
}: {
  description?: string;
  automaticSave?: boolean;
  className?: string;
}) {
  useLocale();
  return description || automaticSave ? (
    <InfoPopover
      className={`settings-page-help shrink-0 ${className}`}
      label={t("About this page")}
    >
      {description ? <p>{description}</p> : null}
      {automaticSave ? <p>{t("Changes save automatically")}</p> : null}
    </InfoPopover>
  ) : null;
}

/**
 * A titled topic of related settings: a heading above a thin-bordered, rounded frame whose
 * rows are separated by hairline dividers (owner decision 2026-10-31, V3-013; no gray fill).
 * Children should be `Row`s and a closing `AdvancedSettings`; wrap other content in a stacked Row.
 *
 * - `description`: one short muted line under the title (default). Long detail goes in `info`.
 *   `descriptionVisible={false}` keeps the old behavior of hiding it behind an info popover.
 * - `modified` + `onReset`: small reset icon next to the title while the group differs from default.
 * - `variant`: kept for existing callers; `"box"` hints an ownership/editing unit and uses the
 *   same frame.
 */
export function Group({
  id,
  title,
  description,
  action,
  layout = "columns",
  variant = "open",
  descriptionVisible = true,
  info,
  modified,
  onReset,
  resetLabel,
  scope,
  dependency,
  persistence,
  feedback,
  children,
}: {
  /** Matches a `SETTINGS_INDEX` id when the whole card is the search target. */
  id?: string;
  title: ReactNode;
  description?: string;
  action?: ReactNode;
  /** Kept for existing callers; the frame no longer changes with it. */
  layout?: "columns" | "full";
  variant?: "open" | "box";
  /** One short muted line under the title (default `true`); `false` moves it into an info popover. */
  descriptionVisible?: boolean;
  /** Longer explanation for an information popover beside the title. */
  info?: ReactNode;
  children: ReactNode;
} & SettingReset &
  SettingDetails) {
  const revealed = useContext(RevealedSetting);
  const flash = id != null && revealed === id;
  const headingId = useId();
  const descriptionId = useId();
  const hasInfo = Boolean(description) && !descriptionVisible;
  const hasDescription = Boolean(description || scope || dependency || persistence);
  const controls = useControlDescriptions(hasDescription ? descriptionId : undefined);

  return (
    <section
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-revealed={flash || undefined}
      data-settings-layout={layout}
      data-settings-variant={variant}
      tabIndex={-1}
      aria-labelledby={headingId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      className="settings-group"
    >
      <div className="settings-group-heading">
        <div className="settings-group-title">
          <div className="settings-title-line">
            <h2 id={headingId} className="settings-section-title">
              {title}
            </h2>
            {hasInfo ? (
              <InfoPopover className="shrink-0">
                <p>{description}</p>
              </InfoPopover>
            ) : null}
            {info}
            {modified && onReset ? (
              <SettingResetButton onReset={onReset} label={resetLabel} />
            ) : null}
          </div>
          <div id={descriptionId}>
            {hasInfo ? (
              <p className="sr-only">{description}</p>
            ) : null}
            {descriptionVisible && description ? (
              <p className="settings-description settings-help-text">{description}</p>
            ) : null}
            <SettingContext scope={scope} dependency={dependency} />
            <SettingDescriptionText persistence={persistence} />
            <SettingStatus persistence={persistence} />
          </div>
        </div>
        {action ? <div className="settings-group-action">{action}</div> : null}
      </div>
      <div
        ref={controls}
        className="settings-group-content"
      >
        {children}
        {feedback ? <div className="settings-group-feedback">{feedback}</div> : null}
      </div>
    </section>
  );
}

/**
 * One setting: title + one short muted `description` on the left, control on the right at one
 * compact height and one right edge. Put long or rare detail in `info` (ⓘ), not in `description`.
 *
 * - `descriptionVisible={false}`: old behavior, hide `description` behind an info popover.
 * - `modified` + `onReset`: small reset icon next to the title while the value differs from its
 *   default, e.g. `<Row modified={size !== 14} onReset={() => setSize(14)} …>`.
 * - `dependsOn`: marks a dependent sub-row (indented). Pass the parent's state, e.g.
 *   `<Row dependsOn={glassOn} disabledReason={t("Turn on Main pane glass first")} …>`.
 *   `false` dims the row and makes its controls inert; `disabledReason` shows as a tooltip (and is
 *   read by assistive technology) instead of a repeated sentence. Do not also write
 *   "your choice is preserved" text.
 * - `disabled`: the same dimmed, inert state without the indent (e.g. while an operation runs).
 * - `stacked`: wide controls (fields, editors, lists) sit under the label at full width.
 */
export function Row({
  id,
  label,
  description,
  scope,
  dependency,
  persistence,
  feedback,
  controlId,
  stacked = false,
  descriptionVisible = true,
  info,
  dependsOn,
  disabled = false,
  disabledReason,
  modified,
  onReset,
  resetLabel,
  children,
}: {
  /** Matches a `SETTINGS_INDEX` id so search can scroll here. */
  id?: string;
  label: ReactNode;
  description?: string;
  children?: ReactNode;
  /** Optional native control id for a clickable label. */
  controlId?: string;
  /** Wide controls (text fields, editors, lists) sit under the label at full width. */
  stacked?: boolean;
  /** One short muted line under the label (default `true`); `false` moves it into an info popover. */
  descriptionVisible?: boolean;
  /** Longer explanation for an information popover beside the label. */
  info?: ReactNode;
  /** Dependent sub-row: indented; `false` (the parent is off) disables it. Omit for a normal row. */
  dependsOn?: boolean;
  /** Dim the row and make its controls inert without making it a sub-row. */
  disabled?: boolean;
  /** Why the row is disabled; shown as a tooltip and read by assistive technology. */
  disabledReason?: string;
} & SettingReset &
  SettingDetails) {
  const revealed = useContext(RevealedSetting);
  const flash = id != null && revealed === id;
  const labelId = useId();
  const descriptionId = useId();
  const inactive = disabled || dependsOn === false;
  const hasInfo = Boolean(description) && !descriptionVisible;
  const hasDescription = Boolean(
    description || scope || dependency || persistence || (inactive && disabledReason),
  );
  const controls = useControlDescriptions(hasDescription ? descriptionId : undefined);

  return (
    <div
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-revealed={flash || undefined}
      data-stacked={stacked || undefined}
      data-dependent={dependsOn !== undefined || undefined}
      data-disabled={inactive || undefined}
      title={inactive ? disabledReason : undefined}
      tabIndex={-1}
      className="settings-row"
    >
      <div className="settings-row-label">
        <div className="settings-title-line">
          {controlId ? (
            <label
              id={labelId}
              htmlFor={controlId}
              className="settings-row-title"
            >
              {label}
            </label>
          ) : (
            <div id={labelId} className="settings-row-title">
              {label}
            </div>
          )}
          {hasInfo ? (
            <InfoPopover className="shrink-0">
              <p>{description}</p>
            </InfoPopover>
          ) : null}
          {info}
          {modified && onReset ? (
            <SettingResetButton onReset={onReset} label={resetLabel} />
          ) : null}
        </div>
        <div id={descriptionId}>
          {hasInfo ? (
            <p className="sr-only">{description}</p>
          ) : null}
          {descriptionVisible && description ? (
            <p className="settings-description settings-help-text">{description}</p>
          ) : null}
          <SettingContext scope={scope} dependency={dependency} />
          {inactive && disabledReason ? <span className="sr-only">{disabledReason}</span> : null}
          <SettingDescriptionText persistence={persistence} />
          <SettingStatus persistence={persistence} />
        </div>
      </div>
      <div
        ref={controls}
        role={children ? "group" : undefined}
        aria-labelledby={children ? labelId : undefined}
        aria-describedby={hasDescription ? descriptionId : undefined}
        aria-disabled={inactive || undefined}
        inert={inactive || undefined}
        className="settings-row-control"
      >
        {children}
      </div>
      {feedback ? <div className="settings-row-feedback">{feedback}</div> : null}
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
        className={`min-w-[5ch] shrink-0 text-right text-ui-caption tabular-nums ${disabled ? "text-(--ui-text-disabled)" : "text-content"}`}
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
