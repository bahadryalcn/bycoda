import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Group, Row } from "../../../shared/ui/settings";
import type { AccountNotice, AccountState } from "../model/accountState";

const REJECTED_CONFIG =
  /^This build's sign-in configuration was rejected by the account server \((\w+)\)\.$/;

/**
 * A failed sign-in as shown: a translated title, and the raw host message only behind Details.
 * The one message the UI can act on is localized into the title itself.
 */
export function signInFailure(message: string | null): { title: string; detail?: string } {
  const title = t("Sign-in did not finish. Try again.");
  if (!message) return { title };
  const code = REJECTED_CONFIG.exec(message)?.[1];
  if (code) {
    return {
      title: t("This build's sign-in configuration was rejected by the account server ({p0}).", {
        p0: code,
      }),
    };
  }
  return { title, detail: message };
}

function noticeText(notice: Exclude<AccountNotice, "sign-in-failed">): string {
  switch (notice) {
    case "session-ended":
      return t("Your bycoda session ended. Sign in again to use your account.");
    case "device-revoked":
      return t("This computer was signed out from another device.");
    case "declined":
      return t("Sign-in was cancelled in the browser.");
  }
}

function NoticeMessage({ notice, message }: { notice: AccountNotice; message: string | null }) {
  if (notice !== "sign-in-failed") {
    return (
      <InlineMessage tone={notice === "declined" ? "neutral" : "warning"}>
        {noticeText(notice)}
      </InlineMessage>
    );
  }
  const failure = signInFailure(message);
  return (
    <InlineMessage
      tone="warning"
      extra={
        failure.detail ? <ErrorDetails title={failure.title} detail={failure.detail} /> : undefined
      }
    >
      {failure.title}
    </InlineMessage>
  );
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
        state.notice ? <NoticeMessage notice={state.notice} message={state.message} /> : undefined
      }
    >
      <Row
        label={t("An account is optional. Without one, bycoda works fully on this computer.")}
        info={
          <InfoPopover className="shrink-0" label={t("Account")}>
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
