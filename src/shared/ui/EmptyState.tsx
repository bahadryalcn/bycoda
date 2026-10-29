import {
  EmptyState as ArcEmptyState,
  type EmptyStateProps as ArcEmptyStateProps,
} from "./arc/empty-state/empty-state";
import { Button } from "./Button";
import { useT } from "../i18n";

export type { EmptyStateContext } from "./arc/empty-state/empty-state";

/** Why there is nothing to show. The primitive only labels it (`data-kind`); the caller owns the copy. */
export type EmptyStateKind = "empty" | "filtered" | "unavailable";

export type SharedEmptyStateProps = ArcEmptyStateProps & {
  /** Distinguishes no data, a filter with no match and an unavailable source for tests and styling. */
  kind?: EmptyStateKind;
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
  onRetry,
  retryLabel,
  retrying,
  action,
  ...props
}: SharedEmptyStateProps) {
  const t = useT();
  const withRetry = onRetry ? (
    <>
      {action}
      <Button variant="secondary" size="sm" loading={retrying ?? false} onClick={onRetry}>
        {retryLabel ?? t("Retry")}
      </Button>
    </>
  ) : (
    action
  );
  return (
    <ArcEmptyState
      {...props}
      action={withRetry}
      data-kind={kind}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
