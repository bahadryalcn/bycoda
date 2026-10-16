import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { formatCooldown, WRONG_PASSWORD_DELAY_MS } from "../model/attemptThrottle";
import { changeLockPassword, lockCooldownMs, setLockPassword } from "../model/groupLock";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "../model/passwordRecord";
import { PasswordField } from "./PasswordField";
import { pause, useCooldown, verifyFailureMessage } from "./PasswordPromptDialog";

type Props = {
  /** `set` for the first password, `change` to replace the current one. */
  mode: "set" | "change";
  onClose: () => void;
  /** Called once the new password is saved, before the dialog closes. */
  onDone?: () => void;
};

/**
 * Sets or changes the one password that locks every group. The fields are
 * read from their inputs on submit and cleared afterwards; nothing is kept in
 * state.
 */
export function SetLockPasswordDialog({ mode, onClose, onDone }: Props) {
  useLocale();
  const current = useRef<HTMLInputElement>(null);
  const next = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown(mode === "change" ? lockCooldownMs() : 0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const clear = () => {
    for (const field of [current, next, confirm]) {
      if (field.current) field.current.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || cooldown.remainingMs > 0) return;
    const currentPassword = current.current?.value ?? "";
    const password = next.current?.value ?? "";
    const problem = passwordProblem(password);
    if (mode === "change" && !currentPassword) {
      setError("Enter the current password.");
      return;
    }
    if (problem === "short") {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (problem === "long") {
      setError("That password is too long.");
      return;
    }
    if (password !== (confirm.current?.value ?? "")) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "change") {
        const result = await changeLockPassword(currentPassword, password);
        if (!result.ok) {
          clear();
          if (result.reason === "wrong") await pause(WRONG_PASSWORD_DELAY_MS);
          if (!alive.current) return;
          if (result.retryAfterMs > 0) cooldown.start(result.retryAfterMs);
          setError(verifyFailureMessage(result, result.retryAfterMs));
          current.current?.focus();
          return;
        }
      } else {
        await setLockPassword(password);
      }
      if (!alive.current) return;
      clear();
      onDone?.();
      onClose();
    } catch (reason) {
      if (!alive.current) return;
      clear();
      setError(reason instanceof Error ? reason.message : String(reason));
      (mode === "change" ? current : next).current?.focus();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const message =
    cooldown.remainingMs > 0
      ? `Too many wrong passwords. Try again in ${formatCooldown(cooldown.remainingMs)}.`
      : error;

  return (
    <Modal
      title={mode === "set" ? t("Set lock password") : t("Change lock password")}
      description={t("One password locks any number of groups.")}
      size="sm"
      fitViewport
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        {mode === "change" ? (
          <PasswordField
            label={t("Current password")}
            ref={current}
            autoFocus
            invalid={message != null}
          />
        ) : null}
        <PasswordField label={t("New password")} ref={next} autoFocus={mode === "set"} />
        <PasswordField
          label={t("Confirm new password")}
          ref={confirm}
          describedBy={message ? "set-lock-password-error" : undefined}
          invalid={message != null && mode === "set"}
        />
        {message ? (
          <p id="set-lock-password-error" role="alert" className="text-[12px] text-danger">
            {message}
          </p>
        ) : null}
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-snug text-content/50">
          <li>
            {t("This hides locked groups inside ")}
            {PRODUCT_IDENTITY.displayName}
            {t(
              ". It does not encrypt your project files, the session database, or the Claude Code and Codex transcripts on disk; anyone with access to this computer's files can still read them.",
            )}
          </li>
          <li>
            {t(
              "Only a salted hash is stored on this computer. A forgotten password cannot be recovered, only reset from Settings, which removes the lock from every group.",
            )}
          </li>
        </ul>
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
            disabled={busy || cooldown.remainingMs > 0}
            className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium text-content hover:bg-selection-hover disabled:opacity-40"
          >
            {mode === "set" ? t("Set password") : t("Change password")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
