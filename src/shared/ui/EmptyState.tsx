import {
  EmptyState as ArcEmptyState,
  type EmptyStateProps as ArcEmptyStateProps,
} from "./arc/empty-state/empty-state";
import { Button } from "./Button";
import { CircleAlert, Search } from "./icons";
import { useT } from "../i18n";

export type { EmptyStateContext } from "./arc/empty-state/empty-state";

/**
 * Why there is nothing to show; the caller owns the copy.
 * - `empty`: the source answered and has no data. Offer the one start action.
 * - `filtered`: data exists but a search or filter hides it. Offer `onReset`, not creation.
 * - `unavailable`: the source could not be read (connection, permission, error). Never an
 *   empty-data message; offer `onRetry` where the owner supports it.
 * Loading is none of these: show progress or a skeleton, never an EmptyState.
 */
export type EmptyStateKind = "empty" | "filtered" | "unavailable";

export type SharedEmptyStateProps = ArcEmptyStateProps & {
  /**
   * `block` (default): the Arc state, sized by `context` (page, panel or list).
   * `inline`: one compact start-aligned caption row ("No matching servers." plus an optional
   * reset or action link), for a list, picker or settings group that is empty. No glyph
   * unless `icon` is passed, no motion. Replaces a bare `<p>No …</p>`.
   */
  size?: "block" | "inline";
  /** Distinguishes no data, a filter with no match and an unavailable source for assistive tech and styling. */
  kind?: EmptyStateKind;
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

/** A search result or an unreadable source changes while the user watches; announce it. */
function impliedRole(kind: EmptyStateKind | undefined) {
  return kind === "unavailable" ? "alert" : kind === "filtered" ? "status" : undefined;
}

/** The compact row: caption copy and link-style recovery on one line, wrapping when narrow. */
function InlineEmptyState({
  className,
  kind,
  onReset,
  resetLabel,
  onRetry,
  retryLabel,
  retrying,
  action,
  role,
  icon,
  title,
  description,
  label,
  context: _context,
  ...props
}: Omit<SharedEmptyStateProps, "size">) {
  const t = useT();
  return (
    <div
      {...props}
      role={role ?? impliedRole(kind)}
      aria-label={label ?? props["aria-label"]}
      data-kind={kind}
      data-size="inline"
      className={[
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-ui-caption text-(--ui-text-secondary)",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? (
        <span aria-hidden className="flex shrink-0 text-(--ui-text-muted)">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 break-words">
        {title ? <strong className="font-medium text-(--ui-tone-neutral-fg)">{title} </strong> : null}
        {description}
      </span>
      {action}
      {onReset ? (
        <Button variant="link" layout="text" onClick={onReset}>
          {resetLabel ?? t("Reset filters")}
        </Button>
      ) : null}
      {onRetry ? (
        <Button variant="link" layout="text" loading={retrying ?? false} onClick={onRetry}>
          {retryLabel ?? t("Retry")}
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  className,
  size = "block",
  kind,
  onReset,
  resetLabel,
  onRetry,
  retryLabel,
  retrying,
  action,
  role,
  icon,
  ...props
}: SharedEmptyStateProps) {
  const t = useT();
  if (size === "inline")
    return (
      <InlineEmptyState
        {...props}
        className={className}
        kind={kind}
        onReset={onReset}
        resetLabel={resetLabel}
        onRetry={onRetry}
        retryLabel={retryLabel}
        retrying={retrying}
        action={action}
        role={role}
        icon={icon}
      />
    );
  const hasActions = Boolean(action) || Boolean(onReset) || Boolean(onRetry);
  const actions = hasActions ? (
    <>
      {action}
      {onReset ? (
        <Button variant="secondary" size="sm" onClick={onReset}>
          {resetLabel ?? t("Reset filters")}
        </Button>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" loading={retrying ?? false} onClick={onRetry}>
          {retryLabel ?? t("Retry")}
        </Button>
      ) : null}
    </>
  ) : undefined;
  const implied = impliedRole(kind);
  // An unreadable source or a hidden match must not wear the "nothing here" folder glyph.
  const glyph =
    icon !== undefined ? icon : kind === "unavailable" ? (
      <CircleAlert width={24} height={24} strokeWidth={1.5} />
    ) : kind === "filtered" ? (
      <Search width={24} height={24} strokeWidth={1.5} />
    ) : undefined;
  return (
    <ArcEmptyState
      {...props}
      icon={glyph}
      role={role ?? implied}
      action={actions}
      data-kind={kind}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
