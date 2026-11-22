import { useState } from "react";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Switch } from "../../../shared/ui/Switch";
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
  const [revertFiles, setRevertFiles] = useState(false);
  const unavailable = planLoading
    ? t("Checking session file history…")
    : (plan?.unavailable ?? (!plan ? t("Session file history is unavailable.") : undefined));
  const conflicts = plan?.files.filter((file) => file.conflict) ?? [];
  const mode: EditFromHereMode = revertFiles && !unavailable ? "files" : "keep";
  const reverting = revertFiles && !unavailable ? plan!.files.length - conflicts.length : 0;

  return (
    <Modal
      title={t("Edit from here?")}
      description={t("The chat returns to before this message. Your prompt returns to the composer.")}
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
            variant="primary"
            loading={!!pending}
            loadingLabel={pending === "files" ? t("Reverting files…") : t("Rewinding…")}
            onClick={() => onConfirm(mode)}
          >
            {t("Edit from here")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Switch
          label={t("Also revert file changes")}
          checked={revertFiles && !unavailable}
          disabled={!!pending || !!unavailable}
          onCheckedChange={setRevertFiles}
        />
        {planLoading ? (
          <Text as="p" role="status" size="body" tone="inherit">
            {unavailable}
          </Text>
        ) : unavailable ? (
          <Text as="p" size="body" tone="inherit">
            {unavailable}
          </Text>
        ) : (
          <Text as="p" size="body" tone="inherit">
            {revertFiles
              ? t("Files to revert: {p0}", { p0: reverting })
              : t("Your files stay as they are.")}
          </Text>
        )}
        {revertFiles && !unavailable && conflicts.length ? (
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
        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Modal>
  );
}
