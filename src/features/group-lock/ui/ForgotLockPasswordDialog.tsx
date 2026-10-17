import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useState, type FormEvent } from "react";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Alert } from "../../../shared/ui/Alert";
import { Modal } from "../../../shared/ui/Modal";
import { resetForgottenPassword } from "../model/groupLock";

const PHRASE = "reset lock";

type Props = {
  onClose: () => void;
};

/**
 * The way out when the password is lost: it removes the password and the lock
 * from every group. Bycoda cannot tell who is at the keyboard, so the only
 * safeguard is a deliberate confirmation phrase.
 */
export function ForgotLockPasswordDialog({ onClose }: Props) {
  useLocale();
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toLowerCase() === PHRASE;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    resetForgottenPassword();
    onClose();
  };

  return (
    <Modal
      title={t("Reset lock password")}
      description={t("Removes the password and every group lock.")}
      size="sm"
      fitViewport
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <p className="text-[12px] leading-snug text-content/70">
          {t(
            "The password cannot be recovered. Resetting removes it and unlocks all groups. Their projects stay in the groups and nothing is deleted. You can set a new password afterwards and lock groups again.",
          )}
        </p>
        <Alert tone="warning">
          {PRODUCT_IDENTITY.displayName}
          {t(
            " cannot check who you are, so anyone using this computer can do this. The lock is a privacy screen, not a security boundary.",
          )}
        </Alert>
        <TextField
          label={`${t("Type “")}${PHRASE}${t("” to confirm")}`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoFocus
          spellCheck={false}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose} variant="ghost">
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={!confirmed} variant="primary" tone="danger">
            {t("Reset lock")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
