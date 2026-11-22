import { Text } from "../../../shared/ui/Text";
import { useState, type FormEvent } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { KeyRound } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { PasswordField } from "../../../shared/ui/PasswordField";
import {
  cancelOwnerSecretInput,
  submitOwnerSecretInput,
  MAX_OWNER_SECRET_LENGTH,
  type OwnerSecretInput,
} from "../model/ownerSecretInputs";

const MESSAGE = /^Project: (.*)\nName: (.*)\nPurpose: ([\s\S]*)$/;

/** Splits the Host's fixed "Project/Name/Purpose" message; any other text is shown whole as the purpose. */
export function parseOwnerSecretMessage(message: string) {
  const match = MESSAGE.exec(message);
  return match
    ? { project: match[1], name: match[2], purpose: match[3] }
    : { project: "", name: "", purpose: message };
}

/** Key glyph and title, plus the reference note behind an info button. */
export function OwnerSecretHeader({ request }: { request: OwnerSecretInput }) {
  const t = useT();
  const { project, name } = parseOwnerSecretMessage(request.message);
  return (
    <div className="flex items-start gap-2">
      <Text as="span" size="inherit" tone="info" className="mt-0.5 flex shrink-0">
        <KeyRound aria-hidden className="icon-md" />
      </Text>
      <Heading as="div" size="item" className="min-w-0 flex-1 break-words">
        {name ? t("Enter secret: {p0}", { p0: name }) : t("Secret request")}
      </Heading>
      <InfoPopover className="shrink-0">
        {project ? (
          <Text as="p" size="caption" tone="primary" className="break-all">
            {t("Project: {p0}", { p0: project })}
          </Text>
        ) : null}
        <Text as="p" size="caption" tone="secondary">
          {t(
            "The agent receives only a reference. The value is encrypted on this device, stays saved for this project until you remove it in Settings → Secrets, and never appears in chat or transcripts.",
          )}
        </Text>
      </InfoPopover>
    </div>
  );
}

/** The typed text lives in this component only until submit, which clears it before settling. */
export function OwnerSecretForm({ request }: { request: OwnerSecretInput }) {
  const t = useT();
  const { formatNumber } = useFormat();
  const [value, setValue] = useState("");
  const { purpose } = parseOwnerSecretMessage(request.message);
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
      {purpose ? (
        <Text as="p" size="body" tone="primary" className="max-h-32 overflow-auto break-words">
          {purpose}
        </Text>
      ) : null}
      <PasswordField
        label={request.fieldLabel}
        value={value}
        error={
          tooLong
            ? t("Secret must be {p0} characters or fewer.", {
                p0: formatNumber(MAX_OWNER_SECRET_LENGTH, {
                  useGrouping: false,
                }),
              })
            : undefined
        }
        onChange={(event) => setValue(event.currentTarget.value)}
        autoFocus
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => cancelOwnerSecretInput(request.id)}
        >
          {t(request.cancelLabel)}
        </Button>
        <Button size="sm" type="submit" disabled={!value || tooLong}>
          {t(request.confirmLabel)}
        </Button>
      </div>
    </form>
  );
}

/** Off-screen conversations use this dialog; closing it only defers the request, the Cancel button rejects it. */
export function OwnerSecretDialog({
  request,
  onClose,
}: {
  request: OwnerSecretInput;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal onClose={onClose} title={t("Secret request")} size="sm">
      <div className="flex flex-col gap-3">
        <OwnerSecretHeader request={request} />
        <OwnerSecretForm request={request} />
      </div>
    </Modal>
  );
}
