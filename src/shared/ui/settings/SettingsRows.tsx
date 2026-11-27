import { actionHostAttributes } from "../ActionHost";
import { surfaceAttributes } from "../Surface";
import { Text } from "../Text";
import { useContext, useEffect, useId, useRef, type ReactNode } from "react";

import { FieldLabel } from "../Field";
import { InlineMessage } from "../InlineError";
import { Badge } from "../Badge";
import { LoadingText } from "../LoadingText";
import { useTooltip } from "../Tooltip";
import { Button } from "../Button";
import { Heading } from "../Heading";
import { SettingsOperationFeedback, type SettingsFeedbackProps } from "./SettingsFeedback";
import { InfoTooltip } from "../InfoPopover";
import { RotateCcw } from "../icons";

import { useT } from "../../i18n";

// Settings rows appear in feature dialogs before SettingsView loads, so they own their CSS.
import "./settings.css";

import {
  LayerEditorHeadings,
  PageAutomaticSaveHint,
  RevealedSetting,
  settingDomId,
} from "./settingsContexts";

/**
 * Small reset icon shown next to a title only while a setting differs from its default.
 * Rows and groups render it from `modified` + `onReset`; use it directly for custom headers.
 * @group actions
 * @use Restore-default icon beside a custom settings title.
 * @avoid Any other action: Button. On a Row or Group: pass `modified` and `onReset` instead.
 */
export function SettingResetButton({
  onReset,
  label,
  disabled = false,
}: {
  onReset: () => void;
  /** Accessible name. Defaults to "Restore default". */
  label?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const name = label ?? t("Restore default");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      label={name}
      className="settings-reset shrink-0"
      textTone="secondary"
      onClick={onReset}
      disabled={disabled}
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
  /** Accessible name of the reset icon. Defaults to "Restore default". */
  resetLabel?: string;
};

type SettingDetails = {
  scope?: ReactNode;
  dependency?: ReactNode;
  persistence?: SettingsPersistence;
  /** Operation feedback occupies its own line below the associated controls. */
  feedback?: ReactNode;
};

/**
 * Operation feedback for a settings row or group (loading, success, error, empty, warning), with
 * the inset empty-state presentation Settings uses inside a frame.
 * @group feedback
 * @use Feedback tied to one settings operation, passed as `feedback` on a Row or Group.
 * @avoid A page-level notice: Alert. One validation message: InlineError.
 */
export function SettingsFeedback(props: SettingsFeedbackProps) {
  if (props.state !== "empty" || props.presentation !== "inset")
    return <SettingsOperationFeedback {...props} />;
  return (
    <div className="settings-feedback" data-state="empty" data-presentation="inset">
      <InlineMessage
        tone="neutral"
        icon={null}
        live="polite"
        action={props.action}
        secondaryAction={props.secondaryAction}
        extra={props.extra}
      >
        {props.children}
      </InlineMessage>
    </div>
  );
}

/** A hidden description and a plain-string `info` share one tooltip. */
function HelpSlot({ description, info }: { description?: ReactNode; info: ReactNode }) {
  if (description == null || description === "") return <InfoSlot info={info} />;
  if (info != null && typeof info !== "string") {
    return (
      <>
        <InfoTooltip className="shrink-0">{description}</InfoTooltip>
        <InfoSlot info={info} />
      </>
    );
  }
  return (
    <InfoTooltip className="shrink-0">
      {description}
      {info && info !== description ? ` ${info}` : null}
    </InfoTooltip>
  );
}

/** A plain-string `info` becomes a tooltip. Custom nodes render as given. */
function InfoSlot({ info }: { info: ReactNode }) {
  return typeof info === "string" ? (
    <InfoTooltip className="shrink-0">{info}</InfoTooltip>
  ) : (
    <>{info}</>
  );
}

/** Essential scope and dependencies stay visible beside the setting. */
function SettingContext({ scope, dependency }: Pick<SettingDetails, "scope" | "dependency">) {
  return (
    <>
      {scope ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          leading="normal"
          className="settings-description settings-scope"
        >
          {scope}
        </Text>
      ) : null}
      {dependency ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          leading="normal"
          className="settings-description settings-dependency"
        >
          {dependency}
        </Text>
      ) : null}
    </>
  );
}

/** Visible persistence state only: errors, unsaved/saving/saved and explicit-save guidance. */
function SettingStatus({ persistence }: Pick<SettingDetails, "persistence">) {
  const t = useT();
  const state = persistence?.state;
  const showSaveHint = persistence?.mode === "explicit";
  // An explicit save shows its progress in its own Save action; an automatic one shows a delayed
  // line, so a quick save never flashes a badge.
  const saving = state === "saving";
  const showSaving = saving && !showSaveHint;
  if (!persistence || !(showSaveHint || (state && state !== "idle" && (!saving || showSaving))))
    return null;
  return (
    <Text as="div" size="caption" tone="secondary" leading="normal" className="settings-hint">
      {showSaveHint ? <span>{t("Changes require saving")}</span> : null}
      {showSaving ? (
        <LoadingText size="caption" tone="secondary">
          {t("Saving…")}
        </LoadingText>
      ) : null}
      {state && state !== "idle" && !saving ? (
        <Badge
          tone={state === "error" ? "danger" : state === "saved" ? "success" : "warning"}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {state === "dirty" ? t("Unsaved changes") : null}
          {state === "saved" ? t("Saved") : null}
          {/* oxlint-disable-next-line bycoda/no-raw-error-text -- persistence.error is the owner-written ReactNode message, documented as such on SettingsPersistence */}
          {state === "error" ? (persistence.error ?? t("Could not save changes")) : null}
        </Badge>
      ) : null}
    </Text>
  );
}

/** Screen-reader description for a group or row; the automatic-save note lives here, not on screen. */
function SettingDescriptionText({ persistence }: Pick<SettingDetails, "persistence">) {
  const t = useT();
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
 * A titled topic of related settings: a heading above a thin-bordered, rounded frame whose
 * rows are separated by hairline dividers (owner decision 2026-10-31, V3-013; no gray fill).
 * Children should be `Row`s; wrap other content in a stacked Row.
 *
 * - `description`: behind the info (ⓘ) affordance by default. `descriptionVisible` shows it as a
 *   muted subline, only for scope, dependency or consequence.
 * - `modified` + `onReset`: small reset icon next to the title while the group differs from default.
 * - `variant`: kept for existing callers; `"box"` hints an ownership/editing unit and uses the
 *   same frame.
 * @group layout
 * @use A titled topic of related settings rows on a settings page or in a feature dialog.
 * @avoid Content that is not a setting: Surface. A collapsible panel: Disclosure. One setting: Row.
 */
export function Group({
  id,
  title,
  description,
  action,
  layout = "columns",
  variant = "open",
  descriptionVisible = false,
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
  /** Show `description` as a muted subline (default `false`: in a tooltip). */
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
  const layerEditor = useContext(LayerEditorHeadings);
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
      data-settings-flat={layerEditor || undefined}
      tabIndex={-1}
      aria-labelledby={headingId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      {...surfaceAttributes({ frame: "none", radius: "card" }, "settings-group")}
    >
      <div className="settings-group-heading">
        <div className="settings-group-title">
          <div className="settings-title-line">
            <Heading
              id={headingId}
              size={layerEditor ? "item" : "section"}
              tone="primary"
              leading={layerEditor ? "normal" : undefined}
              className="settings-section-title"
            >
              {title}
            </Heading>
            <HelpSlot description={hasInfo ? description : undefined} info={info} />
            {modified && onReset ? (
              <SettingResetButton onReset={onReset} label={resetLabel} />
            ) : null}
          </div>
          <div id={descriptionId}>
            {hasInfo ? <p className="sr-only">{description}</p> : null}
            {descriptionVisible && description ? (
              <Text
                as="p"
                size="caption"
                tone="muted"
                leading="normal"
                className="settings-description settings-help-text"
              >
                {description}
              </Text>
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
        {...surfaceAttributes(
          {
            variant: layerEditor ? undefined : "card",
            frame: layerEditor ? "none" : "card",
            radius: "card",
            layout: layerEditor ? "settings-group-flat" : "settings-group",
            reveal: "group",
          },
          "settings-group-content",
        )}
      >
        {children}
        {feedback ? (
          <div
            {...surfaceAttributes(
              { frame: "pane", edge: "block-start" },
              "settings-group-feedback",
            )}
          >
            {feedback}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One setting: title + one short muted `description` on the left, control on the right at one
 * compact height and one right edge. Put long or rare detail in `info` (ⓘ), not in `description`.
 *
 * - `description` sits in the info (ⓘ) tooltip. `descriptionVisible` opts into a visible muted
 *   subline, only for scope, dependency or consequence.
 * - `modified` + `onReset`: small reset icon next to the title while the value differs from its
 *   default, e.g. `<Row modified={size !== 14} onReset={() => setSize(14)} …>`.
 * - `dependsOn`: marks a dependent sub-row (indented). Pass the parent's state, e.g.
 *   `<Row dependsOn={glassOn} disabledReason={t("Turn on Main pane glass first")} …>`.
 *   `false` dims the row and makes its controls inert; `disabledReason` shows as a tooltip (and is
 *   read by assistive technology) instead of a repeated sentence. Do not also write
 *   "your choice is preserved" text.
 * - `disabled`: the same dimmed, inert state without the indent (e.g. while an operation runs).
 * - `stacked`: wide controls (fields, editors, lists) sit under the label at full width.
 * - `controlWidth`: `"aligned"` (16rem) to share a fixed column across a group,
 *   `"wide"` (28rem) for a pair of selects or a short field, `"fill"` for a control that takes all the
 *   room the label leaves (segmented choice, card strip). Default keeps the 12-18rem right column.
 *   In a narrow row (below 35rem) every non-stacked control stays beside its label while both fit
 *   and wraps under it only when they do not, so a switch or short select never stacks.
 * - `density="compact"`: the row inset steps down (`--ui-row-inset-block-compact`) for short rows.
 * - `feedbackPosition="start"`: the feedback (a preview) sits above the label and control.
 * @group layout
 * @use One setting inside a Group: label and description left, control right.
 * @avoid A row of a data list: CollectionRow. A whole topic: Group. A labelled form field outside settings: Field.
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
  controlWidth = "default",
  density = "default",
  feedbackPosition = "end",
  descriptionVisible = false,
  descriptionTone = "secondary",
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
  /** Width of the right-hand control column: `wide` 28rem, `fill` the whole remaining width. Ignored when `stacked`. */
  controlWidth?: "default" | "aligned" | "wide" | "fill";
  /** `compact` steps the row inset down for short rows (one control, no description). */
  density?: "default" | "compact";
  /** `start` places the feedback above the label and control (a preview that opens the row). */
  feedbackPosition?: "end" | "start";
  /** Show `description` as a muted subline (default `false`: in a tooltip). */
  descriptionVisible?: boolean;
  /** Use `muted` for metadata such as a timestamp. */
  descriptionTone?: "secondary" | "muted";
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
  const layerEditor = useContext(LayerEditorHeadings);
  const flash = id != null && revealed === id;
  const labelId = useId();
  const descriptionId = useId();
  const inactive = disabled || dependsOn === false;
  const hasInfo = Boolean(description) && !descriptionVisible;
  const hasDescription = Boolean(
    description || scope || dependency || persistence || (inactive && disabledReason),
  );
  const controls = useControlDescriptions(hasDescription ? descriptionId : undefined);
  // The row keeps its place as a direct child of the group (sibling selectors), so the shared
  // tooltip hook is spread on it instead of a wrapper element. Inert children are skipped by
  // hit-testing, so the row itself receives the pointer.
  const reasonTip = useTooltip({
    label: inactive ? disabledReason : undefined,
    align: "start",
    describe: false,
  });

  const rowSurface = surfaceAttributes({ radius: "none", reveal: "row" }, "settings-row");
  const feedbackContent = feedback ? <div className="settings-row-feedback">{feedback}</div> : null;
  return (
    <div
      id={id ? settingDomId(id) : undefined}
      data-setting-id={id}
      data-settings-part="row"
      data-settings-flat={layerEditor || undefined}
      data-revealed={flash || undefined}
      data-stacked={stacked || undefined}
      data-control-width={controlWidth === "default" ? undefined : controlWidth}
      data-density={layerEditor ? "compact" : density === "default" ? undefined : density}
      data-feedback-position={feedbackPosition === "end" ? undefined : feedbackPosition}
      data-dependent={dependsOn !== undefined || undefined}
      data-disabled={inactive || undefined}
      tabIndex={-1}
      {...rowSurface}
      {...actionHostAttributes(
        stacked || layerEditor ? undefined : { variant: "settings" },
        rowSurface.className,
      )}
      {...(inactive && disabledReason ? reasonTip.trigger : null)}
      role={inactive ? "group" : undefined}
      aria-labelledby={inactive ? labelId : undefined}
      aria-describedby={inactive && hasDescription ? descriptionId : undefined}
      aria-disabled={inactive || undefined}
    >
      {feedbackPosition === "start" ? feedbackContent : null}
      <div className="settings-row-label">
        <div className="settings-title-line">
          {controlId ? (
            <FieldLabel
              size="secondary"
              tone="primary"
              weight="regular"
              leading="normal"
              id={labelId}
              htmlFor={controlId}
              className="settings-row-title"
            >
              {label}
            </FieldLabel>
          ) : (
            <Text
              as="div"
              size="secondary"
              tone="primary"
              weight="regular"
              leading="normal"
              id={labelId}
              className="settings-row-title"
            >
              {label}
            </Text>
          )}
          <HelpSlot description={hasInfo ? description : undefined} info={info} />
          {modified && onReset ? (
            <SettingResetButton onReset={onReset} label={resetLabel} disabled={inactive} />
          ) : null}
        </div>
        <div id={descriptionId}>
          {hasInfo ? <p className="sr-only">{description}</p> : null}
          {descriptionVisible && description ? (
            <Text
              as="p"
              size="caption"
              tone={descriptionTone}
              leading="normal"
              className="settings-description settings-help-text"
            >
              {description}
            </Text>
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
      {feedbackPosition === "end" ? feedbackContent : null}
      {reasonTip.tooltip}
    </div>
  );
}
