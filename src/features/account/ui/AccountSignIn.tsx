import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Group, Row } from "../../../shared/ui/settings";
import type { AccountNotice, AccountState } from "../model/accountState";

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
      <Group title={t("bycoda account")}>
        <Row label={t("Complete sign-in in your browser")}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t("Stop")}
          </Button>
        </Row>
      </Group>
    );
  }
  return (
    <Group
      title={t("bycoda account")}
      feedback={
        state.notice ? (
          <InlineMessage tone={state.notice === "declined" ? "neutral" : "warning"}>
            {noticeText(state.notice, state.message)}
          </InlineMessage>
        ) : undefined
      }
    >
      <Row
        label={t("An account is optional. Without one, bycoda works fully on this computer.")}
        info={
          <InfoPopover className="shrink-0">
            <ul>
              <li>{t("See your devices and active time everywhere")}</li>
              <li>{t("Choose which notifications reach you")}</li>
              <li>{t("Sign out lost devices remotely")}</li>
            </ul>
          </InfoPopover>
        }
      >
        <Button variant="primary" size="sm" onClick={onSignIn}>
          {t("Sign in with browser")}
        </Button>
      </Row>
    </Group>
  );
}
