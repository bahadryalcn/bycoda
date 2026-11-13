import { t, useLocale } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { formatCooldown, WRONG_PASSWORD_DELAY_MS } from "../model/attemptThrottle";
import { changeLockPassword, lockCooldownMs, setLockPassword } from "../model/groupLock";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "../model/passwordRecord";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
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
  const formId = useId();
  const current = useRef<HTMLInputElement>(null);
  const next = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"current" | "next" | "confirm">(
    mode === "change" ? "current" : "next",
  );
  const fail = (field: "current" | "next" | "confirm", message: string) => {
    setErrorField(field);
    setError(message);
    ({ current, next, confirm })[field].current?.focus();
  };
  const cooldown = useCooldown(mode === "change" ? lockCooldownMs() : 0);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- tracks mounted dialog lifetime so pending password writes cannot close a replacement dialog
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronizes retry focus with the current or new password field becoming editable after a failed verification.
  useEffect(() => {
    if (!busy && error) ({ current, next, confirm })[errorField].current?.focus();
  }, [busy, error, errorField]);

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
      fail("current", t("Enter the current password."));
      return;
    }
    if (problem === "short") {
      fail("next", t("Use at least {p0} characters.", { p0: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (problem === "long") {
      fail("next", t("That password is too long."));
      return;
    }
    if (password !== (confirm.current?.value ?? "")) {
      fail("confirm", t("The two passwords do not match."));
      return;
    }
    setBusy(true);
    setErrorField(mode === "change" ? "current" : "next");
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
      setError(t(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const message =
    cooldown.remainingMs > 0
      ? t("Too many wrong passwords. Try again in {p0}.", {
          p0: formatCooldown(cooldown.remainingMs),
        })
      : error;

  return (
    <Modal
      title={mode === "set" ? t("Set lock password") : t("Change lock password")}
      description={t("One password locks any number of groups.")}
      size="sm"
      fitViewport
      // The running change cannot be cancelled, so the dialog stays until it finishes.
      onClose={busy ? () => {} : onClose}
      footer={
        <ModalActions>
          <Button type="button" onClick={onClose} variant="ghost" disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || cooldown.remainingMs > 0}
            variant="primary"
            loading={busy}
          >
            {mode === "set" ? t("Set password") : t("Change password")}
          </Button>
        </ModalActions>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
        {mode === "change" ? (
          <PasswordField
            label={t("Current password")}
            ref={current}
            disabled={busy}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={(message != null && errorField === "current") || undefined}
            aria-describedby={
              message && errorField === "current" ? "set-lock-password-error" : undefined
            }
          />
        ) : null}
        <PasswordField
          label={t("New password")}
          ref={next}
          disabled={busy}
          autoFocus={mode === "set"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          description={t("Use at least {p0} characters.", { p0: PASSWORD_MIN_LENGTH })}
          aria-invalid={(message != null && errorField === "next") || undefined}
          aria-describedby={
            message && errorField === "next" ? "set-lock-password-error" : undefined
          }
        />
        <PasswordField
          label={t("Confirm new password")}
          ref={confirm}
          disabled={busy}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby={
            message && errorField === "confirm" ? "set-lock-password-error" : undefined
          }
          aria-invalid={(message != null && errorField === "confirm") || undefined}
        />
        {message ? (
          <Alert id="set-lock-password-error" tone="danger">
            {message}
          </Alert>
        ) : null}
        <Text
          as="ul"
          size="micro"
          tone="muted"
          leading="snug"
          className="flex list-disc flex-col gap-1 pl-4"
        >
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
        </Text>
      </form>
    </Modal>
  );
}
