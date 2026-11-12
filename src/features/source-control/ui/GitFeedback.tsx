import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { InlineError } from "../../../shared/ui/InlineError";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { createNote } from "../../notes";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
import { copyText } from "../../../platform/tauri/clipboard";
import { requestWorktreeManagement } from "../model/worktreeManagement";

export function GitLoading({ text }: { text: string }) {
  useLocale();
  return <LoadingText className="px-3 py-2">{t(text)}</LoadingText>;
}

type GitFeedbackProps = {
  kind?: "error" | "warning" | "success" | "info";
  title: string;
  detail?: string;
  stale?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  cwd?: string;
};

export function GitFeedback(props: GitFeedbackProps) {
  // Each diagnostic owns its pending actions and feedback, even when A is
  // replaced by B and then returns before an old A request finishes.
  return (
    <GitFeedbackContent
      key={JSON.stringify([props.kind, props.title, props.detail, props.cwd])}
      {...props}
    />
  );
}

function GitFeedbackContent({
  kind = "error",
  title,
  detail,
  stale,
  onRetry,
  onDismiss,
  cwd,
}: GitFeedbackProps) {
  useLocale();
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const copyPending = useRef(false);
  const notePending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const context = [title, cwd, detail].filter(Boolean).join("\n\n");
  const branchInWorktree =
    kind === "error" && !!detail && /cannot delete branch[\s\S]*used by worktree/i.test(detail);
  return (
    <Alert
      tone={kind === "error" ? "danger" : kind}
      inline
      className="mx-2 my-0.5 min-w-0 shrink-0"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Text as="div" size="inherit" tone="primary">
          {title}
        </Text>
        {detail ? (
          <Button
            variant="link"
            onClick={() => setOpen(true)}
            aria-label={`${t("Details")}: ${title}`}
            aria-haspopup="dialog"
          >
            {t("Details")}
          </Button>
        ) : null}
        {onRetry ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t("Retry")}
          </Button>
        ) : null}
        {onDismiss ? (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t("Dismiss")}
          </Button>
        ) : null}
      </div>
      {stale ? (
        <Text as="p" size="inherit" tone="secondary" className="mt-1">
          {t("Showing what was last loaded.")}
        </Text>
      ) : null}
      {open && detail ? (
        <Modal
          title={title}
          languageDomain="git"
          onClose={() => setOpen(false)}
          footer={
            <ModalActions align="start">
              <Button
                variant="link"
                loading={copying}
                onClick={async () => {
                  if (copyPending.current) return;
                  copyPending.current = true;
                  setCopying(true);
                  setCopyError(undefined);
                  try {
                    await copyText(detail);
                    if (alive.current) setCopied(true);
                  } catch (error) {
                    if (alive.current)
                      setCopyError(error instanceof Error ? error.message : String(error));
                  } finally {
                    copyPending.current = false;
                    if (alive.current) setCopying(false);
                  }
                }}
              >
                {t(copied ? "Copied" : "Copy output")}
              </Button>
              <Button
                loading={saving}
                disabled={saved}
                onClick={async () => {
                  if (notePending.current || saved) return;
                  notePending.current = true;
                  setSaving(true);
                  setCopyError(undefined);
                  try {
                    await createNote({ title, body: context, sourceCwd: cwd });
                    if (alive.current) setSaved(true);
                  } catch (error) {
                    if (alive.current)
                      setCopyError(error instanceof Error ? error.message : String(error));
                  } finally {
                    notePending.current = false;
                    if (alive.current) setSaving(false);
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
            </ModalActions>
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            {cwd ? (
              <Text as="p" size="inherit" tone="secondary" className="break-all">
                {cwd}
              </Text>
            ) : null}
            {branchInWorktree ? (
              <Text as="p" size="inherit" tone="secondary" className="[margin-block-start:0.25rem]">
                {t(
                  "This branch is in use by a worktree. Delete the worktree first, then delete the branch.",
                )}
              </Text>
            ) : null}
            <OutputBlock
              tone="primary"
              tabIndex={0}
              aria-label={t("Output")}
              className="max-h-[50dvh] min-w-0 overflow-auto break-all"
            >
              {detail}
            </OutputBlock>
            {copied || saved ? (
              <Text role="status" as="p" size="inherit" tone="secondary">
                {t(saved ? "Saved" : "Copied")}
              </Text>
            ) : null}
            {copyError ? <InlineError>{copyError}</InlineError> : null}
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
