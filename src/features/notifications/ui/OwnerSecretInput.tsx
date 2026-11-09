import { useState, type FormEvent } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { PasswordField } from "../../../shared/ui/PasswordField";
import {
  cancelOwnerSecretInput,
  submitOwnerSecretInput,
  type OwnerSecretInput,
} from "../model/ownerSecretInputs";

/** The typed text lives in this component only until submit, which clears it before settling. */
export function OwnerSecretForm({ request }: { request: OwnerSecretInput }) {
  const t = useT();
  const [value, setValue] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entered = value;
    setValue("");
    submitOwnerSecretInput(request.id, entered);
  };
  return (
    <form className="flex flex-col gap-3" autoComplete="off" onSubmit={submit}>
      <PasswordField
        label={request.fieldLabel}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t(
          "The agent receives only a reference. The value is encrypted on this device, stays saved for this project until you remove it in Settings → Secrets, and never appears in chat or transcripts.",
        )}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={() => cancelOwnerSecretInput(request.id)}>
          {t(request.cancelLabel)}
        </Button>
        <Button type="submit" disabled={!value}>
          {t(request.confirmLabel)}
        </Button>
      </div>
    </form>
  );
}

/** Off-screen conversations use this dialog; closing it cancels the request. */
export function OwnerSecretDialog({ request }: { request: OwnerSecretInput }) {
  const t = useT();
  return (
    <Modal onClose={() => cancelOwnerSecretInput(request.id)} title={t("Secret request")} size="sm">
      <div className="flex flex-col gap-3">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary)">
          {request.message}
        </pre>
        <OwnerSecretForm request={request} />
      </div>
    </Modal>
  );
}
