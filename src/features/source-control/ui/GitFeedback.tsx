import { Alert } from "../../../shared/ui/Alert";
import { Progress } from "../../../shared/ui/Progress";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { createNote } from "../../notes";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import { copyText } from "../../../platform/tauri/clipboard";
import { requestWorktreeManagement } from "../model/worktreeManagement";

export function GitLoading({ text }: { text: string }) {
  useLocale();
  return (
    <div role="status" className="px-3 py-2">
      <Progress label={text} compact />
    </div>
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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setCopied(false);
    setSaved(false);
    setOpen(false);
    setCopyError(undefined);
  }, [title, detail, cwd]);
  const context = [title, cwd, detail].filter(Boolean).join("\n\n");
  const branchInWorktree =
    kind === "error" && !!detail && /cannot delete branch[\s\S]*used by worktree/i.test(detail);
  return (
    <Alert
      tone={kind === "error" ? "danger" : kind}
      role={kind === "error" ? "alert" : "status"}
      className="mx-2 my-1.5 min-w-0 shrink-0"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div
          className={
            kind === "error"
              ? "text-danger"
              : kind === "warning"
                ? "text-warning"
                : "text-[var(--color-content)]"
          }
        >
          {detail ? (
            <Button
              variant="link"
              tooltip={t("Details")}
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
            >
              {title}
            </Button>
          ) : (
            title
          )}
        </div>
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
      {stale ? (
        <p className="mt-1 text-[var(--ui-text-secondary)]">{t("Showing what was last loaded.")}</p>
      ) : null}
      {open && detail ? (
        <Modal title={title} languageDomain="git" onClose={() => setOpen(false)}>
          <div className="flex min-w-0 flex-col gap-3 p-4">
            {cwd ? <p className="break-all text-(--ui-text-secondary)">{cwd}</p> : null}
            {branchInWorktree ? (
              <p className="[margin-block-start:0.25rem] text-(--ui-text-secondary)">
                {t(
                  "This branch is in use by a worktree. Delete the worktree first, then delete the branch.",
                )}
              </p>
            ) : null}
            <pre
              tabIndex={0}
              aria-label={t("Output")}
              className="max-h-[50dvh] min-w-0 overflow-auto whitespace-pre-wrap break-all select-text font-mono text-xs text-content"
            >
              {detail}
            </pre>
            <div className="flex flex-wrap gap-2">
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
              <Button
                loading={saving}
                disabled={saved}
                onClick={async () => {
                  setSaving(true);
                  setCopyError(undefined);
                  try {
                    await createNote({ title, body: context, sourceCwd: cwd });
                    setSaved(true);
                  } catch (error) {
                    setCopyError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {t(saved ? "Saved" : "Add to notes")}
              </Button>
              <Button
                onClick={() => {
                  requestAddToChat(context, "quote");
                  setOpen(false);
                }}
              >
                {t("Add to chat")}
              </Button>
            </div>
            {copied || saved ? (
              <p role="status" className="text-(--ui-text-secondary)">
                {t(saved ? "Saved" : "Copied")}
              </p>
            ) : null}
            {copyError ? (
              <p role="alert" className="text-danger">
                {copyError}
              </p>
            ) : null}
            {branchInWorktree && cwd ? (
              <Button variant="link" onClick={() => requestWorktreeManagement(cwd)}>
                {t("Manage worktrees…")}
              </Button>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </Alert>
  );
}
