import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { OnboardingHeading } from "./OnboardingHeading";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { useAccount } from "../../account";

/**
 * Optional sign-in step. Skipping stays fully local; signing in only adds cross-device stats.
 * The account service owns the browser flow, this step only starts and reports it.
 */
export function OnboardingAccount() {
  useLocale();
  const { state, signIn, cancelSignIn } = useAccount();
  const signedOut = state.phase === "signed-out" ? state : null;
  const failed = signedOut?.notice === "sign-in-failed" || signedOut?.notice === "session-ended";
  return (
    <>
      <OnboardingHeading
        title={t("Sign in")}
        info={t(
          "An account is optional and only syncs your stats across devices. Your sessions, projects and settings stay on this computer either way. You can sign in later in Settings → Account.",
        )}
      />
      <div className="onboarding-scroll">
        {state.phase === "starting" ? <LoadingText>{t("Loading account…")}</LoadingText> : null}
        {state.phase === "signed-in" ? (
          <Alert tone="success">
            {t("Signed in as {p0}. Your stats now sync across your devices.", {
              p0: state.context.user.displayName || state.context.user.email,
            })}
          </Alert>
        ) : null}
        {state.phase === "signing-in" ? (
          <>
            <LoadingText delay={false}>{t("Waiting for your browser…")}</LoadingText>
            <Text as="p" size="caption" tone="muted" leading="normal" className="onboarding-hint">
              {t("Complete the sign-in in the browser window that opened, then return to bycoda.")}
            </Text>
            <div className="onboarding-actions">
              <Button variant="secondary" onClick={() => cancelSignIn().catch(() => undefined)}>
                {t("Cancel")}
              </Button>
            </div>
          </>
        ) : null}
        {signedOut ? (
          <>
            {failed ? (
              <Alert tone="danger">
                {signedOut.message ?? t("Sign-in did not finish. Try again.")}
              </Alert>
            ) : null}
            {signedOut.notice === "declined" ? (
              <Alert tone="info">{t("Sign-in was cancelled.")}</Alert>
            ) : null}
            <div className="onboarding-actions">
              <Button variant="secondary" onClick={() => signIn().catch(() => undefined)}>
                {t("Sign in with browser")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
