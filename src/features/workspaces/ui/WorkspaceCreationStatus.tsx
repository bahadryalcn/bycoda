import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
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
    <Text
      as="div"
      size="caption"
      tone="secondary"
      data-workspace-creation-status
      className="flex min-w-0 flex-wrap items-center gap-2"
      role={error ? "alert" : "status"}
    >
      {error ? (
        <>
          <Text size="inherit" tone="danger" className="min-w-0 flex-1 break-words">
            {t(error)}
          </Text>
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
        <Tooltip
          label={t("Based on {p0} @ {p1}", {
            p0: shortWorkspaceRef(preview.baseRef),
            p1: preview.baseCommit.slice(0, 8),
          })}
          asChild
        >
          <span className="break-words">
            <Text size="inherit" tone="primary">
              {t("New worktree from {p0}", { p0: shortWorkspaceRef(preview.baseRef) })}
            </Text>
            {preview.excludedPaths > 0 ? (
              <span className="tabular-nums">
                {" · "}
                {t("{p0} uncommitted changes not included", { p0: preview.excludedPaths })}
              </span>
            ) : null}
          </span>
        </Tooltip>
      ) : null}
    </Text>
  );
}
