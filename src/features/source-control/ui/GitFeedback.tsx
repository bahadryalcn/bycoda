import { errorText } from "../../../shared/lib/errors";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { LiveText } from "../../../shared/ui/LiveText";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { t, useLocale } from "../../../shared/i18n/git";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { X } from "../../../shared/ui/icons";
import type { CommitGenerationResult } from "../model/gitPanelState";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { createNote } from "../../notes";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
import { requestWorktreeManagement } from "../model/worktreeManagement";

export function GitLoading({ text }: { text: string }) {
  useLocale();
  return <LoadingText inset="row">{text}</LoadingText>;
}

export function GitCommitGenerationNotice({
  result,
  onUse,
  onDismiss,
  disabled,
}: {
  result: CommitGenerationResult;
  onUse: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}) {
  useLocale();
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
      <InlineMessage tone="warning" className="me-auto flex-1 self-center">
        {result.changesUpdated ? t("Changes updated. Review the message.") : t("AI message ready.")}
      </InlineMessage>
      {result.suggestion && (
        <Button
          size="xs"
          onClick={onUse}
          disabled={disabled}
          disabledReason={disabled ? t("Wait for the current operation to finish") : undefined}
        >
          {t("Use AI message")}
        </Button>
      )}
      <Button size="xs" iconOnly label={t("Dismiss notice")} onClick={onDismiss}>
        <X className="icon-sm" />
      </Button>
    </div>
  );
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
  // Git localizes its hints, but the config keys it names stay in English in every language.
  const divergedPull =
    kind === "error" && !!detail && /advice\.diverging|pull\.rebase|divergent branches/i.test(detail);
  const message = (
    <>
      {title}
      {stale ? ` ${t("Showing what was last loaded.")}` : ""}
    </>
  );
  const noticeProps = {
    inset: "row" as const,
    className: "min-w-0 shrink-0",
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
            <ModalActions
              start={
                <CopyButton
                  variant="ghost"
                  label={t("Copy output")}
                  text={detail}
                  resetKeys={[detail]}
                  onClick={() => setCopyError(undefined)}
                />
              }
            >
              <Button
                variant="ghost"
                loading={saving}
                disabled={saved}
                disabledReason={saved ? t("Already saved to your notes.") : undefined}
                onClick={async () => {
                  if (notePending.current || saved) return;
                  notePending.current = true;
                  setSaving(true);
                  setCopyError(undefined);
                  try {
                    await createNote({ title, body: context, sourceCwd: cwd });
                    if (alive.current) setSaved(true);
                  } catch (error) {
                    if (alive.current) setCopyError(errorText(error));
                  } finally {
                    notePending.current = false;
                    if (alive.current) setSaving(false);
                  }
                }}
              >
                {saved ? t("Saved") : t("Add to notes")}
              </Button>
              <Button
                variant="primary"
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
              <Text as="p" family="mono" tone="secondary" className="break-all">
                {cwd}
              </Text>
            ) : null}
            {divergedPull ? (
              <Text as="p" size="inherit" tone="primary">
                {t(
                  "Your branch and its remote both have new commits, so Git can’t fast-forward. Use Pull (Rebase) in the Git actions menu to replay your commits on top, or merge the remote branch.",
                )}
              </Text>
            ) : null}
            {branchInWorktree ? (
              <Text as="p" size="inherit" tone="secondary" className="mt-1">
                {t(
                  "This branch is in use by a worktree. Delete the worktree first, then delete the branch.",
                )}
              </Text>
            ) : null}
            <OutputBlock
              tone="primary"
              frame="filled"
              density="comfortable"
              scroll
              tabIndex={0}
              aria-label={t("Output")}
              className="max-h-[50dvh]"
            >
              {detail}
            </OutputBlock>
            {saved ? (
              <LiveText size="inherit" tone="secondary" className="block" text={t("Saved")} />
            ) : null}
            {copyError ? (
              <InlineError details={copyError}>{t("Could not save note")}</InlineError>
            ) : null}
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
