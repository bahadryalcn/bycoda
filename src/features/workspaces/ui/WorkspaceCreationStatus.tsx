import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { WorkspaceCreationPreview } from "../model/workspaceCreation";
import { shortWorkspaceRef } from "../model/workspaceCreation";

export function WorkspaceCreationStatus({
  preview,
  pending,
  error,
  onRetry,
  onUseCurrentCheckout,
}: {
  preview?: WorkspaceCreationPreview;
  pending: boolean;
  error?: string;
  onRetry: () => void;
  onUseCurrentCheckout?: () => void;
}) {
  useLocale();
  return (
    <div
      data-workspace-creation-status
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-(--ui-text-secondary)"
      role={error ? "alert" : "status"}
    >
      {error ? (
        <>
          <span className="min-w-0 flex-1 break-words text-(--ui-tone-danger-fg)">{t(error)}</span>
          {onUseCurrentCheckout ? (
            <Button size="sm" variant="secondary" onClick={onUseCurrentCheckout}>
              {t("Use current checkout")}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t("Retry")}
          </Button>
        </>
      ) : pending ? (
        t("Checking workspace policy…")
      ) : preview ? (
        <span className="break-words">
          {t("Based on {p0} @ {p1}; {p2} uncommitted paths excluded", {
            p0: shortWorkspaceRef(preview.baseRef),
            p1: preview.baseCommit.slice(0, 8),
            p2: preview.excludedPaths,
          })}
        </span>
      ) : null}
    </div>
  );
}
