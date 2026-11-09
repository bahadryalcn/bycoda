import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { hasActiveModalOverlay } from "../../../shared/ui/overlay";
import { Toast } from "../../../shared/ui/ToastRegion";
import {
  getStatsChoice,
  recordStatsPromptShown,
  setStatsChoice,
  shouldPromptForStats,
  subscribeAnonymousStats,
} from "../model/accountPrivacy";
import { useAccountState } from "../hooks/useAccount";

const FIRST_DELAY_MS = 6000;
const RETRY_MS = 3000;

/**
 * One-time, non-blocking question for people who were never asked. It waits for dialogs
 * (first-run setup included) to close; every showing counts, so leaving it unanswered asks again
 * next launch, three times at most, and statistics stay off. Hidden in builds without accounts, which send nothing.
 */
export function StatsConsentNotice() {
  useLocale();
  const available = useAccountState().phase !== "unavailable";
  const choice = useSyncExternalStore(subscribeAnonymousStats, getStatsChoice);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!available || !shouldPromptForStats()) return;
    let timer = setTimeout(function check() {
      if (hasActiveModalOverlay() || document.visibilityState !== "visible") {
        timer = setTimeout(check, RETRY_MS);
      } else if (shouldPromptForStats()) {
        recordStatsPromptShown();
        setShown(true);
      }
    }, FIRST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [available]);
  if (!shown || choice !== null) return null;
  const answer = (value: "on" | "off") => {
    setStatsChoice(value);
    setShown(false);
  };
  return (
    <Toast
      tone="info"
      title={t("Share anonymous statistics?")}
      message={t(
        "Once a day: a random install id, app version, operating system, release channel and date. Never your sessions, prompts, code or files. Change it any time in Settings → Privacy.",
      )}
      durationMs={null}
      width="lg"
      actionsPlacement="footer"
      actions={
        <>
          <Button variant="secondary" onClick={() => answer("on")}>
            {t("Share anonymous statistics")}
          </Button>
          <Button variant="secondary" onClick={() => answer("off")}>
            {t("Don't share")}
          </Button>
        </>
      }
      onDismiss={() => setShown(false)}
    />
  );
}
