import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
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
    >
      <div className="flex min-w-0 flex-col gap-4 p-4">
        {planLoading ? (
          <p role="status" className="text-sm text-content-secondary">
            {t("Checking session file history…")}
          </p>
        ) : plan && !plan.unavailable ? (
          <div className="flex min-w-0 flex-col gap-2 text-sm">
            <p>{t("Session files: {p0}", { p0: plan.files.length })}</p>
            {conflicts.length ? (
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-warning">
                  {t("These files will be skipped because they changed:")}
                </p>
                <ul className="flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto">
                  {conflicts.map((file) => (
                    <li key={file.path} className="break-words [overflow-wrap:anywhere]">
                      <span className="font-mono">{file.path}</span>
                      {": "}
                      <span className="text-content-secondary">{file.conflict}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-content-secondary">{unavailable}</p>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" disabled={!!pending} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={!!pending}
            aria-disabled={!!pending || !!unavailable}
            tooltip={unavailable}
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
        </div>
      </div>
    </Modal>
  );
}
