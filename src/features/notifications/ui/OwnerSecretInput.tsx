import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { useState, type FormEvent } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { PasswordField } from "../../../shared/ui/PasswordField";
import {
  cancelOwnerSecretInput,
  submitOwnerSecretInput,
  MAX_OWNER_SECRET_LENGTH,
  type OwnerSecretInput,
} from "../model/ownerSecretInputs";

/** The typed text lives in this component only until submit, which clears it before settling. */
export function OwnerSecretForm({ request }: { request: OwnerSecretInput }) {
  const t = useT();
  const { formatNumber } = useFormat();
  const [value, setValue] = useState("");
  const tooLong = value.length > MAX_OWNER_SECRET_LENGTH;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value || tooLong) return;
    const entered = value;
    setValue("");
    submitOwnerSecretInput(request.id, entered);
  };
  return (
    <form className="flex flex-col gap-3" autoComplete="off" onSubmit={submit}>
      <PasswordField
        label={request.fieldLabel}
        value={value}
        error={
          tooLong
            ? t("Secret must be {p0} characters or fewer.", {
                p0: formatNumber(MAX_OWNER_SECRET_LENGTH, { useGrouping: false }),
              })
            : undefined
        }
        onChange={(event) => setValue(event.currentTarget.value)}
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <Text as="p" size="caption" tone="secondary">
        {t(
          "The agent receives only a reference. The value is encrypted on this device, stays saved for this project until you remove it in Settings → Secrets, and never appears in chat or transcripts.",
        )}
      </Text>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={() => cancelOwnerSecretInput(request.id)}>
          {t(request.cancelLabel)}
        </Button>
        <Button type="submit" disabled={!value || tooLong}>
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
        <OutputBlock size="caption" tone="secondary" className="max-h-48 overflow-auto break-words">
          {request.message}
        </OutputBlock>
        <OwnerSecretForm request={request} />
      </div>
    </Modal>
  );
}
