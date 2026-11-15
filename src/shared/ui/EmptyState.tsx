import type { ReactNode } from "react";
import {
  EmptyState as ArcEmptyState,
  type EmptyStateProps as ArcEmptyStateProps,
} from "./arc/empty-state/empty-state";
import { NoticeButton, NoticeGlyph, NoticeLink, type NoticeAction } from "./Notice";
import { optionalTextAttributes } from "./Text";
import { Search } from "./icons";
import { useT } from "../i18n";

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
  /** Distinguishes no data from a filter with no match for assistive tech and styling. */
  kind?: EmptyStateKind;
  /** The one next step, rendered by the component (secondary button in a block, text link inline). */
  action?: NoticeAction;
  /** A second next step, rendered after `action`. */
  secondaryAction?: NoticeAction;
  /** Escape for one non-button control after the actions (a menu or split trigger). */
  extra?: ReactNode;
  /**
   * Keeps the description visible under the title. By default a titled state puts its description
   * behind the info affordance; set this only when the sentence states scope or consequence (a
   * `filtered` state always shows it). Without a title the description is the message and shows.
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

/** The compact row: caption copy and link-style recovery on one line, wrapping when narrow. */
function InlineEmptyState({
  className,
  kind,
  steps,
  extra,
  role,
  icon,
  title,
  description,
  descriptionText,
  label,
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
  | "showDescription"
> & { steps: NoticeAction[] }) {
  return (
    <div
      {...props}
      role={role ?? impliedRole(kind)}
      aria-label={label ?? props["aria-label"]}
      data-kind={kind}
      data-size="inline"
      className={[
        "flex min-w-0 items-start gap-1.5 text-ui-caption text-(--ui-text-secondary)",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? <NoticeGlyph tone="neutral" size="inline" icon={icon} /> : null}
      <span {...optionalTextAttributes(descriptionText ?? {}, "min-w-0 flex-1 break-words")}>
        {title ? <strong className="font-medium text-content">{title} </strong> : null}
        {description}
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
 * `onRetry`). A titled state keeps its sentence behind the info affordance unless `showDescription`
 * (or a `filtered` kind) says it states scope or consequence. `kind` sets the glyph and live role.
 * @group feedback
 * @use A list, panel or picker with no data or no filter matches. `size="inline"` replaces a bare "No ..." paragraph.
 * @avoid Loading: LoadingText or Skeleton. Unavailable or failed region: FailureState. Inline failure: InlineError. A one-line field or row message: InlineMessage. Boxed notice with a title: Alert. Never a Button in `action`.
 * @action Pass `action={{ label, onClick }}` (+ `secondaryAction`); the component renders it.
 * @arc empty-state
 */
export function EmptyState({
  className,
  size = "block",
  kind,
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
        kind={kind}
        steps={steps}
        extra={extra}
        role={role}
        icon={icon}
        title={title}
        description={description}
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
  // A titled state keeps its sentence behind the info affordance unless it states scope.
  const hasDescription = description !== undefined && description !== null && description !== "";
  const tucked = Boolean(title) && hasDescription && !showDescription && kind !== "filtered";
  // A hidden match must not wear the "nothing here" folder glyph.
  const glyph =
    icon !== undefined ? icon : kind === "filtered" ? <Search aria-hidden /> : undefined;
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
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
