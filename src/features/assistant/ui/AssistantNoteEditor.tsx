import { useId, useState } from "react";
import type { AssistantNote } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { operationId } from "../model/assistantClient";
import { AssistantNoteDraft } from "../model/assistantNoteDraft";
import styles from "./AssistantNoteCard.module.css";
import { assistantRequest as ownerRequest } from "../model/assistantClient";

type OwnerRequest = typeof ownerRequest;

export function NoteEditor({
  request,
  environmentId,
  note,
  onSaved,
  onClose,
}: {
  request: OwnerRequest;
  environmentId?: string;
  note: AssistantNote | "new";
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const original = note === "new" ? null : note;
  const [controller] = useState(
    () => new AssistantNoteDraft(original, localStorage, operationId, environmentId),
  );
  const [draft, setDraft] = useState(() => controller.value);
  const { title, body } = draft;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const save = controller.save(request);
      setDraft(controller.value);
      await save;
      controller.clear();
      await onSaved();
      onClose();
    } catch (cause) {
      setError(t(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={t(original ? "Edit note" : "New note")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="lg"
      fitViewport
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={!title.trim()}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={styles.editorForm}
        onSubmit={(event) => {
          event.preventDefault();
          // ast-grep-ignore: ts-void-promise-without-catch -- save() reports its own failures in state
          void save();
        }}
      >
        <TextField
          label={t("Title")}
          value={title}
          required
          maxLength={300}
          disabled={pending || Boolean(draft.intent)}
          onChange={(event) => {
            controller.update({ title: event.currentTarget.value });
            setDraft(controller.value);
          }}
        />
        <TextareaField
          label={t("Note")}
          value={body}
          minRows={16}
          maxRows={30}
          maxLength={100000}
          disabled={pending || Boolean(draft.intent)}
          onChange={(event) => {
            controller.update({ body: event.currentTarget.value });
            setDraft(controller.value);
          }}
        />
        <LiveText
          className={styles.editorHint}
          text={
            draft.intent && !pending
              ? t("Note save is pending. Retry to verify the original note.")
              : ""
          }
        />
      </form>
    </Modal>
  );
}
