import { errorText } from "../../../shared/lib/errors";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { t, useLocale } from "../../../shared/i18n/git";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { createNote } from "../../notes";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
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
  // A machine connection failure is explained once by the central connection notice.
  const shownCentrally = useConnectionErrorShownCentrally(kind === "error" ? detail : undefined);
  const [copyError, setCopyError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
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
  const message = (
    <>
      {title}
      {stale ? ` ${t("Showing what was last loaded.")}` : ""}
    </>
  );
  const noticeProps = {
    className: "mx-2 my-0.5 min-w-0 shrink-0",
    action: detail ? { label: t("Details"), onClick: () => setOpen(true) } : undefined,
    retry: onRetry ? { onRetry, label: t("Retry") } : undefined,
    secondaryAction: onDismiss ? { label: t("Dismiss"), onClick: onDismiss } : undefined,
  };
  if (shownCentrally) return null;
  return (
    <>
      {kind === "error" ? (
        <InlineError {...noticeProps}>{message}</InlineError>
      ) : (
        <InlineMessage tone={kind} {...noticeProps}>
          {message}
        </InlineMessage>
      )}
      {open && detail ? (
        <Modal
          title={title}
          languageDomain="git"
          onClose={() => setOpen(false)}
          footer={
            <ModalActions align="start">
              <CopyButton
                variant="link"
                label={t("Copy output")}
                text={detail}
                resetKeys={[detail]}
                onClick={() => setCopyError(undefined)}
              />
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
                      setCopyError(errorText(error));
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
            {saved ? (
              <Text role="status" as="p" size="inherit" tone="secondary">
                {t("Saved")}
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
    </>
  );
}
