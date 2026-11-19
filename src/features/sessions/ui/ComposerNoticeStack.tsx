import type { ReactNode } from "react";

/**
 * The one slot for notices attached directly above the composer card (running work, goal, interrupted, provider
 * retry, usage limit, delivery progress). Notices render bare InlineMessage/Alert anatomy
 * with at most one primary action; the stack owns padding and gap, never the notice.
 * Collapses when every child renders nothing. Several simultaneous notices scroll inside a
 * pane-relative cap (`cqb` falls back to viewport units outside a pane), so they never push the
 * transcript out of a small pane; every notice stays mounted, in the DOM and reachable.
 */
export function ComposerNoticeStack({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex max-h-[max(4rem,min(40cqb,14rem))] shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain px-4 has-[[data-activity-dock],[data-provider-goal],[role=alert],[role=status]:not(.sr-only)]:py-1 [&>*]:shrink-0"
      data-composer-notices
    >
      {children}
    </div>
  );
}
