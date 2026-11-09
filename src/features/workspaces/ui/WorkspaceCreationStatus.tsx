import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { WorkspaceCreationPreview } from "../model/workspaceCreation";
import { shortWorkspaceRef } from "../model/workspaceCreation";

export function WorkspaceCreationStatus({
  preview,
  error,
  onRetry,
  onUseCurrentCheckout,
}: {
  preview?: WorkspaceCreationPreview;
  /** Kept for callers; the brief check shows nothing while pending. */
  pending: boolean;
  error?: string;
  onRetry: () => void;
  onUseCurrentCheckout?: () => void;
}) {
  useLocale();
  // The policy check is brief and the send button already explains the hold, so a
  // passing "Checking…" line only flickers under the composer: show nothing until
  // there is a result (the new worktree preview) or an error.
  if (!error && !preview) return null;
  return (
    <div
      data-workspace-creation-status
      className="flex min-w-0 flex-wrap items-center gap-2 text-ui-caption text-(--ui-text-secondary)"
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
      ) : preview ? (
        // The consequence leads; the exact ref and commit are the hover detail.
        <span
          className="break-words"
          title={t("Based on {p0} @ {p1}", {
            p0: shortWorkspaceRef(preview.baseRef),
            p1: preview.baseCommit.slice(0, 8),
          })}
        >
          <span className="text-content">
            {t("New worktree from {p0}", { p0: shortWorkspaceRef(preview.baseRef) })}
          </span>
          {preview.excludedPaths > 0 ? (
            <span className="tabular-nums">
              {" · "}
              {t("{p0} uncommitted changes not included", { p0: preview.excludedPaths })}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
