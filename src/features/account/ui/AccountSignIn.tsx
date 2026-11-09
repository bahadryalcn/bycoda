import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import type { AccountNotice, AccountState } from "../model/accountState";
import styles from "./account.module.css";

const REJECTED_CONFIG =
  /^This build's sign-in configuration was rejected by the account server \((\w+)\)\.$/;

/** Localizes the one host message that the UI can act on; other host messages show as sent. */
function failureText(message: string | null): string {
  if (!message) return t("Sign-in did not finish. Try again.");
  const code = REJECTED_CONFIG.exec(message)?.[1];
  return code
    ? t("This build's sign-in configuration was rejected by the account server ({p0}).", {
        p0: code,
      })
    : message;
}

function noticeText(notice: AccountNotice, message: string | null): string {
  switch (notice) {
    case "session-ended":
      return t("Your bycoda session ended. Sign in again to use your account.");
    case "device-revoked":
      return t("This computer was signed out from another device.");
    case "declined":
      return t("Sign-in was cancelled in the browser.");
    case "sign-in-failed":
      return failureText(message);
  }
}

/** Signed-out and signing-in views. Signing in is optional; the app works the same without it. */
export function AccountSignIn({
  state,
  onSignIn,
  onCancel,
}: {
  state: Extract<AccountState, { phase: "signed-out" | "signing-in" }>;
  onSignIn: () => void;
  onCancel: () => void;
}) {
  useLocale();
  if (state.phase === "signing-in") {
    return (
      <section className={styles.section} aria-labelledby="account-signin">
        <SectionLabel labelId="account-signin">{t("Finish signing in")}</SectionLabel>
        <LoadingText delay={false}>{t("Waiting for your browser…")}</LoadingText>
        <p className={styles.lead}>
          {t("Complete the sign-in in the browser window that opened, then return to bycoda.")}
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel}>
            {t("Cancel")}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="account-signin">
      <SectionLabel labelId="account-signin">{t("bycoda account")}</SectionLabel>
      <p className={styles.lead}>
        {t("An account is optional. Without one, bycoda works fully on this computer.")}
      </p>
      <ul className={styles.benefits}>
        <li>{t("See your devices and active time everywhere")}</li>
        <li>{t("Choose which notifications reach you")}</li>
        <li>{t("Sign out lost devices remotely")}</li>
      </ul>
      <p className={styles.lead}>
        {t("Your sessions, projects and settings stay on this computer either way.")}
      </p>
      {state.notice ? (
        <InlineMessage tone={state.notice === "declined" ? "neutral" : "warning"}>
          {noticeText(state.notice, state.message)}
        </InlineMessage>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" onClick={onSignIn}>
          {t("Sign in with browser")}
        </Button>
      </div>
    </section>
  );
}
