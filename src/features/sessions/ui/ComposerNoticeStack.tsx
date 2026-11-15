import type { ReactNode } from "react";

/**
 * The one slot for notices attached directly above the composer card (interrupted, provider
 * retry, usage limit, delivery progress). Notices render bare InlineMessage/Alert anatomy
 * with at most one primary action; the stack owns padding and gap, never the notice.
 * Collapses when every child renders nothing.
 */
export function ComposerNoticeStack({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-1 px-4 py-1 empty:hidden" data-composer-notices>
      {children}
    </div>
  );
}
