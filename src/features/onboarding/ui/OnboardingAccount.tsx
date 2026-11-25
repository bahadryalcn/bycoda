import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { OnboardingHeading } from "./OnboardingHeading";
import { OnboardingIllustratedStep } from "./OnboardingIllustratedStep";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { signInFailure, useAccount } from "../../account";

/**
 * Optional sign-in step. Skipping stays fully local; signing in only adds cross-device stats.
 * The account service owns the browser flow, this step only starts and reports it.
 */
export function OnboardingAccount() {
  useLocale();
  const { state, signIn, cancelSignIn } = useAccount();
  const signedOut = state.phase === "signed-out" ? state : null;
  const failed = signedOut?.notice === "sign-in-failed" || signedOut?.notice === "session-ended";
  const failure = signedOut && failed ? signInFailure(signedOut.message ?? null) : null;
  return (
    <>
      <OnboardingHeading title={t("Sign in")} />
      <OnboardingIllustratedStep scene="account">
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
            {/* One line carries both the wait and the next action. */}
            <LoadingText delay={false}>{t("Finish signing in in your browser…")}</LoadingText>
            <div className="onboarding-actions">
              <Button variant="secondary" onClick={() => cancelSignIn().catch(() => undefined)}>
                {t("Stop")}
              </Button>
            </div>
          </>
        ) : null}
        {signedOut ? (
          <>
            <Text as="p" size="caption" tone="muted" leading="normal" className="onboarding-note">
              {t(
                "An account is optional and only syncs your stats across devices. Your sessions, projects and settings stay on this computer either way. You can sign in later in Settings → Account.",
              )}
            </Text>
            {failure ? (
              <Alert
                tone="danger"
                title={failure.title}
                extra={
                  failure.detail ? (
                    <ErrorDetails title={failure.title} detail={failure.detail} />
                  ) : undefined
                }
              />
            ) : null}
            <div className="onboarding-actions">
              <Button variant="secondary" onClick={() => signIn().catch(() => undefined)}>
                {t("Sign in with browser")}
              </Button>
            </div>
          </>
        ) : null}
      </OnboardingIllustratedStep>
    </>
  );
}
