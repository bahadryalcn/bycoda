import { EmptyState as ArcEmptyState, type EmptyStateProps } from "./arc/empty-state/empty-state";

export type { EmptyStateProps } from "./arc/empty-state/empty-state";

export function EmptyState({ className, ...props }: EmptyStateProps) {
  return (
    <ArcEmptyState {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}
