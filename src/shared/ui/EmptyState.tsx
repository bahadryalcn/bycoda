import type { ReactNode } from "react";
import {
  EmptyState as ArcEmptyState,
  type EmptyStateProps as ArcEmptyStateProps,
} from "./arc/empty-state/empty-state";
import {
  NoticeButton,
  NoticeGlyph,
  NoticeLink,
  stateInsetClass,
  type NoticeAction,
  type StateInset,
} from "./Notice";
import { optionalTextAttributes } from "./Text";
import { InfoTooltip } from "./InfoPopover";
import { Search } from "./icons";
import { useT } from "../i18n";
import { StateIllustration, type IllustrationName } from "./StateIllustration";
import styles from "./EmptyState.module.css";

export type { EmptyStateContext } from "./arc/empty-state/empty-state";

/**
 * Why there is nothing to show; the caller owns the copy.
 * - `empty`: the source answered and has no data. Offer the one start action.
 * - `filtered`: data exists but a search or filter hides it. Offer `onReset`, not creation.
 * A source that could not be read is FailureState, never an empty-data message.
 * Loading is none of these: show progress or a skeleton, never an EmptyState.
 */
export type EmptyStateKind = "empty" | "filtered";

export type SharedEmptyStateProps = Omit<ArcEmptyStateProps, "action" | "help"> & {
  /**
   * `block` (default): the Arc state, sized by `context` (page, panel or list).
   * `inline`: one compact start-aligned caption row ("No matching servers." plus an optional
   * reset or action link), for a list, picker or settings group that is empty. No glyph
   * unless `icon` is passed, no motion. Replaces a bare `<p>No …</p>`.
   */
  size?: "block" | "inline";
  /**
   * Inner spacing on the Surface padding scale: `none` (default; the container owns it, the block
   * keeps its `context` padding), `row` (8/12, inside a list row or form), `panel` (12/16).
   */
  inset?: StateInset;
  /**
   * Block page and panel only: pixel-guide scene above the title, 144 px (page) or 96 px (panel).
   * Unset picks "search-empty" for a `filtered` kind and "inbox-empty" otherwise; an explicit `icon`
   * replaces that default; `false` shows no mascot. `list` context and `inline` size never show one.
   */
  illustration?: IllustrationName | false;
  /** Distinguishes no data from a filter with no match for assistive tech and styling. */
  kind?: EmptyStateKind;
  /** The one next step, rendered as a button in a block or a text link inline. */
  action?: NoticeAction;
  /** A second next step, rendered after `action`. */
  secondaryAction?: NoticeAction;
  /** Escape for one non-button control after the actions (a menu or split trigger). */
  extra?: ReactNode;
  /**
   * Keeps the description visible under the title. Page and panel states always show it (default
   * true); a titled `list` state puts it behind the info affordance unless this is set or the kind
   * is `filtered`. Without a title the description is the message and shows.
   * `size="inline"` shows the sentence under the title by default; `false` tucks it behind the info glyph.
   */
  showDescription?: boolean;
  /** Adds a Reset action after `action` for a filtered state: clears the search and filters that hide the data. */
  onReset?: () => void;
  resetLabel?: string;
  /** Adds a Retry action after `action`. The initiating button shows its own pending state. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Pending retry: the Retry button shows progress and ignores further presses. */
  retrying?: boolean;
};

export type { SharedEmptyStateProps as EmptyStateProps };

/** A search result that changes while the user watches; announce it. */
function impliedRole(kind: EmptyStateKind | undefined) {
  return kind === "filtered" ? "status" : undefined;
}

/** Every structured next step of one state, in display order. */
function useSteps({
  action,
  secondaryAction,
  onReset,
  resetLabel,
  onRetry,
  retryLabel,
  retrying,
}: Pick<
  SharedEmptyStateProps,
  "action" | "secondaryAction" | "onReset" | "resetLabel" | "onRetry" | "retryLabel" | "retrying"
>): NoticeAction[] {
  const t = useT();
  const steps: NoticeAction[] = [];
  if (action) steps.push(action);
  if (secondaryAction) steps.push(secondaryAction);
  if (onReset) steps.push({ label: resetLabel ?? t("Reset filters"), onClick: onReset });
  if (onRetry)
    steps.push({ label: retryLabel ?? t("Retry"), onClick: onRetry, pending: retrying ?? false });
  return steps;
}

/** The compact row: muted caption copy at the list gutter and compact height, link-style recovery on the same line, wrapping when narrow. No glyph unless `icon` is passed. */
function InlineEmptyState({
  className,
  inset,
  kind,
  steps,
  extra,
  role,
  icon,
  title,
  description,
  descriptionText,
  label,
  showDescription,
  context: _context,
  ...props
}: Omit<
  SharedEmptyStateProps,
  | "size"
  | "action"
  | "secondaryAction"
  | "onReset"
  | "resetLabel"
  | "onRetry"
  | "retryLabel"
  | "retrying"
> & { steps: NoticeAction[] }) {
  // The caption row shows its sentence by default; `showDescription={false}` moves it behind the info glyph.
  const tucked = Boolean(title) && Boolean(description) && showDescription === false;
  return (
    <div
      {...props}
      role={role ?? impliedRole(kind)}
      aria-label={label ?? props["aria-label"]}
      data-kind={kind}
      data-size="inline"
      className={[
        "flex min-w-0 gap-1.5 text-ui-caption text-(--ui-text-secondary)",
        styles.inline,
        stateInsetClass(inset),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? <NoticeGlyph tone="neutral" size="inline" icon={icon} /> : null}
      <span {...optionalTextAttributes(descriptionText ?? {}, "min-w-0 flex-1 break-words")}>
        {title ? (
          <strong className={description && !tucked ? "block font-medium" : "font-medium"}>
            {title}
            {tucked ? (
              <>
                {" "}
                <InfoTooltip>{description}</InfoTooltip>
              </>
            ) : null}
          </strong>
        ) : null}
        {tucked ? null : description}
        {extra ? <> {extra}</> : null}
        {steps.map((step) => (
          <span key={step.label}>
            {" "}
            <NoticeLink action={step} />
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Block (page, panel or list `context`) or inline caption row explaining why nothing is shown:
 * title, one sentence and the next step (`action`, `secondaryAction`, `onReset` for a filter,
 * `onRetry`). Page and panel states show the sentence under the title; a titled
 * `list` state keeps it behind the info affordance unless `showDescription` (or a `filtered` kind). `kind` sets the glyph and live role; page and
 * panel show a mascot by default (see `illustration`), otherwise no glyph unless `icon` is passed. Page and
 * panel fill the free space of their parent and centre in it: the parent must give them the remaining
 * height (flex column / grid with `min-block-size: 0`). `inset` sets inner spacing.
 * An inline state shows the sentence under the title unless `showDescription={false}`; pass only
 * `description` for a plain one-line caption (no bold title).
 * @group feedback
 * @use A list, panel or picker with no data or no filter matches. `size="inline"` replaces a bare "No ..." paragraph. `illustration` picks another mascot scene or `false` drops it.
 * @avoid Loading: LoadingText or Skeleton. Unavailable or failed region: FailureState. Inline failure: InlineError. A one-line field or row message: InlineMessage. Boxed notice with a title: Alert. Never a Button in `action`.
 * @action Pass `action={{ label, onClick }}` (+ `secondaryAction`); the component renders it.
 * @arc empty-state
 */
export function EmptyState({
  className,
  size = "block",
  inset,
  kind,
  illustration,
  action,
  secondaryAction,
  extra,
  showDescription,
  onReset,
  resetLabel,
  onRetry,
  retryLabel,
  retrying,
  role,
  icon,
  title,
  description,
  ...props
}: SharedEmptyStateProps) {
  const steps = useSteps({
    action,
    secondaryAction,
    onReset,
    resetLabel,
    onRetry,
    retryLabel,
    retrying,
  });
  if (size === "inline")
    return (
      <InlineEmptyState
        {...props}
        className={className}
        inset={inset}
        kind={kind}
        steps={steps}
        extra={extra}
        role={role}
        icon={icon}
        title={title}
        description={description}
        showDescription={showDescription}
      />
    );
  const actions =
    steps.length || extra ? (
      <>
        {steps.map((step) => (
          <NoticeButton key={step.label} action={step} />
        ))}
        {extra}
      </>
    ) : undefined;
  const context = props.context ?? "page";
  const hasDescription = description !== undefined && description !== null && description !== "";
  // Only a titled list row keeps its sentence behind the info affordance, unless it states scope.
  const tucked =
    context === "list" &&
    Boolean(title) &&
    hasDescription &&
    !showDescription &&
    kind !== "filtered";
  // The mascot leads a page or panel; a filtered match must not wear the "nothing here" scene.
  const art =
    illustration === false || context === "list"
      ? undefined
      : (illustration ??
        (icon === undefined ? (kind === "filtered" ? "search-empty" : "inbox-empty") : undefined));
  const glyph = art ? (
    <StateIllustration name={art} size={context === "page" ? "page" : "panel"} />
  ) : icon !== undefined ? (
    icon
  ) : kind === "filtered" && context === "list" ? (
    <Search aria-hidden />
  ) : undefined;
  return (
    <ArcEmptyState
      {...props}
      title={title}
      description={tucked ? undefined : description}
      help={tucked ? description : undefined}
      icon={glyph}
      role={role ?? impliedRole(kind)}
      action={actions}
      data-kind={kind}
      className={["bycoda-arc", stateInsetClass(inset), className].filter(Boolean).join(" ")}
    />
  );
}
