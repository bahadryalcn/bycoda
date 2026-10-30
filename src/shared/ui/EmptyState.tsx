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

export function EmptyState({
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
  ...props
}: SharedEmptyStateProps) {
  const t = useT();
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
  // A search result or an unreadable source changes while the user watches; announce it.
  const implied = kind === "unavailable" ? "alert" : kind === "filtered" ? "status" : undefined;
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
