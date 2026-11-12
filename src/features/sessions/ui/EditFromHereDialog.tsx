import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import type { SessionFilesRevertPlan } from "../model/editFromHere";

export type EditFromHereMode = "keep" | "files";

export type EditFromHereDialogProps = {
  plan: SessionFilesRevertPlan | null;
  planLoading: boolean;
  pending: EditFromHereMode | null;
  error: string | null;
  onCancel: () => void;
  onConfirm: (mode: EditFromHereMode) => void;
};

export function EditFromHereDialog({
  plan,
  planLoading,
  pending,
  error,
  onCancel,
  onConfirm,
}: EditFromHereDialogProps) {
  const t = useT();
  const unavailable = planLoading
    ? t("Checking session file history…")
    : (plan?.unavailable ?? (!plan ? t("Session file history is unavailable.") : undefined));
  const conflicts = plan?.files.filter((file) => file.conflict) ?? [];

  return (
    <Modal
      title={t("Edit from here?")}
      description={t(
        'Rewind chat to before this message. Your prompt and attachments return to the composer. "Revert files too" also undoes your own edits.',
      )}
      size="md"
      onClose={() => {
        if (!pending) onCancel();
      }}
      footer={
        <ModalActions>
          <Button variant="secondary" disabled={!!pending} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={!!pending || !!unavailable}
            disabledReason={unavailable}
            loading={pending === "files"}
            loadingLabel={t("Reverting files…")}
            onClick={() => {
              if (!unavailable && !pending) onConfirm("files");
            }}
          >
            {t("Revert files too")}
          </Button>
          <Button
            variant="primary"
            disabled={!!pending}
            loading={pending === "keep"}
            loadingLabel={t("Rewinding…")}
            onClick={() => onConfirm("keep")}
          >
            {t("Revert and keep changes")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        {planLoading ? (
          <Text as="p" role="status" size="body" tone="inherit">
            {t("Checking session file history…")}
          </Text>
        ) : plan && !plan.unavailable ? (
          <Text as="div" size="body" tone="inherit" className="flex min-w-0 flex-col gap-2">
            <p>{t("Session files: {p0}", { p0: plan.files.length })}</p>
            {conflicts.length ? (
              <div className="flex min-w-0 flex-col gap-1">
                <InlineMessage tone="warning" live="off">
                  {t("These files will be skipped because they changed:")}
                </InlineMessage>
                <ul className="flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto">
                  {conflicts.map((file) => (
                    <li key={file.path} className="break-words [overflow-wrap:anywhere]">
                      <Code>{file.path}</Code>
                      {": "}
                      <Text as="span" size="inherit" tone="inherit">
                        {file.conflict}
                      </Text>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Text>
        ) : (
          <Text as="p" size="body" tone="inherit">
            {unavailable}
          </Text>
        )}
        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Modal>
  );
}
