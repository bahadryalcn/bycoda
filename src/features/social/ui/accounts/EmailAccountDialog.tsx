import { InlineError } from "../../../../shared/ui/InlineError";
import { useId, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";

import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { PasswordField } from "../../../../shared/ui/PasswordField";
import { Select } from "../../../../shared/ui/Select";
import { TextField } from "../../../../shared/ui/TextField";
import type { EmailAccount } from "../../model/outreach";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import {
  EMAIL_KINDS,
  emailFormError,
  emailSaveInput,
  type EmailDraft,
  type EmailKind,
} from "./emailAccountForm";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type EmailAccountDialogProps = {
  client: SocialClient;
  onClose(): void;
  onCreated(accountId: string): void;
};

function kindText(kind: EmailKind): string {
  switch (kind) {
    case "smtp":
      return t("SMTP server");
    case "resend":
      return "Resend";
    case "postmark":
      return "Postmark";
  }
}

const EMPTY: EmailDraft = {
  kind: "smtp",
  from: "",
  name: "",
  host: "",
  port: "587",
  secure: false,
  unsubscribeUrl: "",
  secret: "",
};

/**
 * Adds a sending email account. The secret goes to the Host's vault and is never shown again; the
 * unsubscribe link is required because every outbound email carries it.
 */
export function EmailAccountDialog({ client, onClose, onCreated }: EmailAccountDialogProps) {
  const formId = useId();
  const [draft, setDraft] = useState<EmailDraft>(EMPTY);
  const { error, is, write } = useAccountWrite(
    t("The email account could not be saved. Try again."),
  );
  const update = (patch: Partial<EmailDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const problem = emailFormError(draft, "create");
  const gate: ActionGate = problem
    ? { disabled: true, disabledReason: problem }
    : { disabled: false };
  const secretLabel = draft.kind === "smtp" ? t("SMTP password") : t("API key");

  const submit = () =>
    void write("email", () => client.email.accounts.save(emailSaveInput(draft)))
      .then((saved: EmailAccount | undefined) => saved && onCreated(saved.id))
      .catch(() => undefined);

  return (
    <Modal
      title={t("Add email account")}
      onClose={() => {
        if (!is("email")) onClose();
      }}
      size="md"
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={is("email")} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <DisabledReason
            type="submit"
            form={formId}
            variant="primary"
            loading={is("email")}
            {...gateProps(gate)}
          >
            {t("Save email account")}
          </DisabledReason>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="social-field-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!gate.disabled) submit();
        }}
      >
        <Select
          label={t("Email provider")}
          value={draft.kind}
          options={EMAIL_KINDS.map((kind) => ({ value: kind, label: kindText(kind) }))}
          onValueChange={(value) => update({ kind: value as EmailKind, secret: "" })}
        />
        <TextField
          label={t("Name")}
          value={draft.name}
          maxLength={200}
          onChange={(event) => update({ name: event.currentTarget.value })}
        />
        <TextField
          label={t("Sender address")}
          type="email"
          value={draft.from}
          onChange={(event) => update({ from: event.currentTarget.value })}
        />
        <TextField
          label={t("Unsubscribe link")}
          type="url"
          placeholder="https://"
          value={draft.unsubscribeUrl}
          description={t("Every email carries this link so people can opt out.")}
          onChange={(event) => update({ unsubscribeUrl: event.currentTarget.value })}
        />
        {draft.kind === "smtp" ? (
          <>
            <TextField
              label={t("SMTP server")}
              value={draft.host}
              onChange={(event) => update({ host: event.currentTarget.value })}
            />
            <TextField
              label={t("Port")}
              numeric
              value={draft.port}
              onChange={(event) => update({ port: event.currentTarget.value })}
            />
            <Checkbox
              checked={draft.secure}
              onChange={(event) => update({ secure: event.target.checked })}
              label={t("Use TLS")}
              size="secondary"
              leading="inherit"
              className="social-check"
            />
          </>
        ) : null}
        <PasswordField
          label={secretLabel}
          autoComplete="new-password"
          value={draft.secret}
          description={t("Stored on this computer. It is not shown again.")}
          onChange={(event) => update({ secret: event.currentTarget.value })}
        />
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
