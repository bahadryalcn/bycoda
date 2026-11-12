import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { Text } from "../../../shared/ui/Text";
import { getStatsChoice, setStatsChoice, subscribeAnonymousStats } from "../../account";

/** Optional statistics question. Both answers are equal; skipping leaves it off and asks later. */
export function OnboardingStatistics() {
  useLocale();
  const choice = useSyncExternalStore(subscribeAnonymousStats, getStatsChoice);
  return (
    <>
      <div className="onboarding-heading">
        <Heading size="page" level={3}>
          {t("Share anonymous statistics?")}
        </Heading>
        <Text as="p" size="inherit" tone="muted" leading="normal">
          {t(
            "Once a day bycoda can send a small signal that helps count installs and plan support. It is off unless you say yes.",
          )}
        </Text>
      </div>
      <div className="onboarding-scroll">
        <Text as="ul" size="caption" tone="inherit" leading="inherit" className="onboarding-hint">
          <li>
            {t(
              "Sent: a random install id, the app version, the operating system, the release channel and the date.",
            )}
          </li>
          <li>
            {t(
              "Never sent: your sessions, prompts, code, file names, projects or account details.",
            )}
          </li>
        </Text>
        <div className="onboarding-actions">
          <Button variant="secondary" onClick={() => setStatsChoice("on")}>
            {t("Share anonymous statistics")}
          </Button>
          <Button variant="secondary" onClick={() => setStatsChoice("off")}>
            {t("Don't share")}
          </Button>
        </div>
        {choice ? (
          <Alert tone="success">
            {choice === "on" ? t("Thank you. Statistics are on.") : t("Statistics stay off.")}
          </Alert>
        ) : null}
        <Text as="p" size="caption" tone="muted" leading="normal" className="onboarding-hint">
          {t(
            "You can change this any time in Settings → Account → Privacy & data, or in Settings → Privacy without an account.",
          )}
        </Text>
      </div>
    </>
  );
}
