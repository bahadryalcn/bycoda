import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useState, type FormEvent } from "react";
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
        <p className="text-[12px] leading-snug text-amber-400">
          {PRODUCT_IDENTITY.displayName}
          {t(
            " cannot check who you are, so anyone using this computer can do this. The lock is a privacy screen, not a security boundary.",
          )}
        </p>
        <label className="flex flex-col gap-1 text-[12px] text-content/60">
          {t("Type “")}
          {PHRASE}
          {t("” to confirm")}
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoFocus
            spellCheck={false}
            className="w-full rounded-lg border border-content/15 bg-content/3 px-3 py-2 text-[13px] text-content outline-none focus:border-content/35"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={!confirmed}
            className="rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/30 disabled:opacity-40"
          >
            {t("Reset lock")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
