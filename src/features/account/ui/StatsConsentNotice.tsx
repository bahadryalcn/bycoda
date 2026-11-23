import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
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
import { statsDisclosure } from "../model/statsDisclosure";

const FIRST_DELAY_MS = 6000;
const RETRY_MS = 3000;

/**
 * One-time, non-blocking question for people who were never asked. It waits for dialogs
 * (first-run setup included) to close; the showing counts, so it is asked once and statistics
 * stay off unless the owner opts in. Hidden in builds without accounts, which send nothing.
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
      title={t("Anonymous statistics")}
      message={statsDisclosure()}
      durationMs={null}
      width="lg"
      actionsPlacement="footer"
      actions={[
        { label: t("Share"), onClick: () => answer("on") },
        { label: t("Don't share"), onClick: () => answer("off") },
      ]}
      onDismiss={() => setShown(false)}
    />
  );
}
