import { t, useLocale } from "../../../shared/i18n/git";
import { Loader } from "../../../shared/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { copyText } from "../../../platform/tauri/clipboard";
import { requestWorktreeManagement } from "../model/worktreeManagement";

export function GitLoading({ text }: { text: string }) {
  useLocale();
  return (
    <p role="status" className="flex items-center gap-2 px-3 py-2 text-[12px] text-content/55">
      <Loader aria-hidden className="size-3.5 shrink-0 animate-spin" />
      {text}
    </p>
  );
}

export function GitFeedback({
  kind = "error",
  title,
  detail,
  stale,
  onRetry,
  onDismiss,
  cwd,
}: {
  kind?: "error" | "warning" | "success" | "info";
  title: string;
  detail?: string;
  stale?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  cwd?: string;
}) {
  useLocale();
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  useEffect(() => {
    setCopied(false);
    setCopyError(undefined);
  }, [detail]);
  const branchInWorktree =
    kind === "error" && !!detail && /cannot delete branch[\s\S]*used by worktree/i.test(detail);
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="mx-2 my-1.5 min-w-0 shrink-0 rounded-md border border-stroke bg-(--ui-surface) px-2.5 py-2 text-[12px]"
    >
      <p
        className={
          kind === "error" ? "text-danger" : kind === "warning" ? "text-warning" : "text-content/80"
        }
      >
        {title}
      </p>
      {stale ? <p className="mt-1 text-content/55">{t("Showing what was last loaded.")}</p> : null}
      {branchInWorktree ? (
        <p className="[margin-block-start:0.25rem] text-(--ui-text-secondary)">
          {t(
            "This branch is in use by a worktree. Delete the worktree first, then delete the branch.",
          )}
        </p>
      ) : null}
      {detail ? (
        <details
          key={detail}
          open={kind === "error"}
          className="[margin-block-start:0.25rem] text-(--ui-text-secondary)"
        >
          <summary className="cursor-pointer">{t("Output")}</summary>
          <pre
            tabIndex={0}
            className="max-h-48 overflow-auto whitespace-pre-wrap break-all [margin-block-start:0.25rem] select-text font-mono text-[11px]"
          >
            {detail}
          </pre>
          <Button
            variant="link"
            loading={copying}
            onClick={async () => {
              setCopying(true);
              setCopyError(undefined);
              try {
                await copyText(detail);
                setCopied(true);
              } catch (error) {
                setCopyError(error instanceof Error ? error.message : String(error));
              } finally {
                setCopying(false);
              }
            }}
          >
            {t(copied ? "Copied" : "Copy output")}
          </Button>
          {copyError ? (
            <p role="alert" className="text-danger">
              {copyError}
            </p>
          ) : null}
        </details>
      ) : null}
      {onRetry || onDismiss || (branchInWorktree && cwd) ? (
        <div className="[margin-block-start:0.375rem] flex flex-wrap gap-2">
          {branchInWorktree && cwd ? (
            <Button variant="link" onClick={() => requestWorktreeManagement(cwd)}>
              {t("Manage worktrees…")}
            </Button>
          ) : null}
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              {t("Retry")}
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="ghost" onClick={onDismiss}>
              {t("Dismiss")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
