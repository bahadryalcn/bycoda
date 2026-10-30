import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { RecoveryBoundary } from "./RecoveryBoundary";

/**
 * Keep optional surfaces out of the composer's startup dependency graph.
 *
 * `suspense: false` leaves loading to the caller's own boundary (navigation keeps the current
 * screen visible). Otherwise `fallback` fills the surface's place while its chunk loads; pass a
 * layout-preserving placeholder for a large region and leave it out for a small popup. A failed
 * import reaches the RecoveryBoundary with a retry, and the failed import is never cached.
 */
export function lazySurface<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  { suspense = true, fallback = null }: { suspense?: boolean; fallback?: ReactNode } = {},
) {
  let pending: ReturnType<typeof load> | undefined;
  const preload = () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
  const Surface = lazy(preload);
  function LazySurface(props: Props) {
    // Navigation uses the app's existing boundary so a transition keeps the
    // current screen visible until the destination has loaded.
    if (!suspense) return <Surface {...props} />;
    return (
      <RecoveryBoundary>
        <Suspense fallback={fallback}>
          <Surface {...props} />
        </Suspense>
      </RecoveryBoundary>
    );
  }
  return Object.assign(LazySurface, { preload });
}
