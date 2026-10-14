import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { formatCooldown, WRONG_PASSWORD_DELAY_MS } from "../model/attemptThrottle";
import { lockCooldownMs, type VerifyResult } from "../model/groupLock";
import { PasswordField } from "./PasswordField";

/** What to tell the user about a refused password, or `null` when it was accepted. */
export function verifyFailureMessage(result: VerifyResult, cooldownMs: number): string | null {
  if (result.ok) return null;
  if (result.reason === "no-password") return "No lock password is set.";
  if (cooldownMs > 0) {
    return `Too many wrong passwords. Try again in ${formatCooldown(cooldownMs)}.`;
  }
  return "Wrong password.";
}

/** Re-renders every half second while a cool-down runs. */
export function useCooldown(initialMs: number): {
  remainingMs: number;
  start: (ms: number) => void;
} {
  const [until, setUntil] = useState(() => (initialMs > 0 ? Date.now() + initialMs : 0));
  const [, tick] = useState(0);
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      tick((value) => value + 1);
      if (Date.now() >= until) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [until]);
  return {
    remainingMs: Math.max(0, until - Date.now()),
    start: (ms) => setUntil(Date.now() + ms),
  };
}

export const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type Props = {
  title: string;
  description: string;
  submitLabel: string;
  danger?: boolean;
  /** Checks the password; the dialog closes through `onDone` when it passes. */
  verify: (password: string) => Promise<VerifyResult>;
  onDone: () => void;
  onClose: () => void;
};

/**
 * Asks for the lock password. A wrong one is answered after a short pause and
 * clears the field; repeated misses start a cool-down kept by the lock model,
 * so closing and reopening this dialog does not skip it.
 */
export function PasswordPromptDialog({
  title,
  description,
  submitLabel,
  danger = false,
  verify,
  onDone,
  onClose,
}: Props) {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown(lockCooldownMs());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const password = input.current?.value ?? "";
    if (busy || cooldown.remainingMs > 0 || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verify(password);
      if (!alive.current) return;
      if (input.current) input.current.value = "";
      if (result.ok) {
        onDone();
        return;
      }
      if (result.reason === "wrong") await pause(WRONG_PASSWORD_DELAY_MS);
      if (!alive.current) return;
      if (result.retryAfterMs > 0) cooldown.start(result.retryAfterMs);
      setError(verifyFailureMessage(result, result.retryAfterMs));
      input.current?.focus();
    } catch (reason) {
      if (!alive.current) return;
      if (input.current) input.current.value = "";
      setError(reason instanceof Error ? reason.message : String(reason));
      input.current?.focus();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const message =
    cooldown.remainingMs > 0
      ? `Too many wrong passwords. Try again in ${formatCooldown(cooldown.remainingMs)}.`
      : error;

  return (
    <Modal title={title} description={description} size="sm" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <PasswordField
          label={t("Lock password")}
          ref={input}
          autoFocus
          invalid={message != null}
          describedBy={message ? "lock-password-error" : undefined}
        />
        {message ? (
          <p id="lock-password-error" role="alert" className="text-[12px] text-danger">
            {message}
          </p>
        ) : null}
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
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-40 ${
              danger
                ? "bg-danger/20 text-danger hover:bg-danger/30"
                : "bg-selection text-content hover:bg-selection-hover"
            }`}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
