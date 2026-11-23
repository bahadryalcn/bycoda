import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { OnboardingHeading } from "./OnboardingHeading";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Text } from "../../../shared/ui/Text";
import {
  getStatsChoice,
  setStatsChoice,
  statsDisclosure,
  subscribeAnonymousStats,
} from "../../account";

/** Optional statistics question. Both answers are equal; skipping leaves it off and asks later. */
export function OnboardingStatistics() {
  useLocale();
  const choice = useSyncExternalStore(subscribeAnonymousStats, getStatsChoice);
  return (
    <>
      <OnboardingHeading title={t("Statistics")} />
      <div className="onboarding-scroll">
        <Text as="p" size="caption" tone="muted" leading="normal" className="onboarding-hint">
          {statsDisclosure()}
        </Text>
        <div className="onboarding-actions">
          <SegmentedControl
            label={t("Statistics")}
            value={choice ?? ""}
            selectionRole="pressed"
            onValueChange={(value) => setStatsChoice(value as "on" | "off")}
            options={[
              { value: "on", label: t("Share anonymous statistics") },
              { value: "off", label: t("Don't share") },
            ]}
          />
        </div>
      </div>
    </>
  );
}
