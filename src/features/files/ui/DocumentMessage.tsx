import type { ReactNode } from "react";
import { FailureState } from "../../../shared/ui/FailureState";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { fitsOneLine } from "../../../shared/ui/ErrorDetails";
import type { NoticeAction } from "../../../shared/ui/Notice";
import { t, useLocale } from "../../../shared/i18n/technical";

/**
 * Centered notice shared by the document viewers: unsupported, failed, empty. A failure reads
 * the same in every viewer: `title` says what happened, `children` say why, `onRetry` and one
 * `action` recover, and the raw `detail` waits behind Show details (a short one-line `detail`
 * becomes the reason when no `children` explain it).
 */
export function DocumentMessage({
  title,
  error,
  detail,
  onRetry,
  retryLabel,
  action,
  extra,
  children,
}: {
  title: string;
  error?: boolean;
  /** Raw technical text of the failure; only with `error`. */
  detail?: string;
  onRetry?: () => void | Promise<unknown>;
  retryLabel?: string;
  action?: NoticeAction;
  /** One non-button control beside the actions (a Copy path button). */
  extra?: ReactNode;
  children?: ReactNode;
}) {
  useLocale();
  const raw = detail?.trim() || undefined;
  const direct = raw && !children && fitsOneLine(raw);
  return (
    <div className="grid h-full min-w-0 place-items-center overflow-auto p-4">
      {error ? (
        <FailureState
          context="list"
          title={title}
          description={
            children ?? (direct ? raw : t("The file could not be read; it may be corrupt."))
          }
          error={direct ? undefined : raw}
          onRetry={onRetry}
          retryLabel={retryLabel}
          action={action}
          extra={extra}
          className="w-full min-w-0 max-w-xl"
        />
      ) : (
        // Children can hold a recovery button (Retry), so they stay visible rather than behind the info affordance.
        <EmptyState title={title} description={children ?? ""} showDescription />
      )}
    </div>
  );
}
