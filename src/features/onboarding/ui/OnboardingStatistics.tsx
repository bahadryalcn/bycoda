import { useId, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { OnboardingHeading } from "./OnboardingHeading";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import {
  getStatsChoice,
  setStatisticsMode,
  statsDisclosure,
  subscribeAnonymousStats,
} from "../../account";

/** Optional statistics question. Both answers are equal; skipping leaves it off and asks later. */
export function OnboardingStatistics() {
  useLocale();
  const choice = useSyncExternalStore(subscribeAnonymousStats, getStatsChoice);
  const disclosureTitle = useId();
  return (
    <>
      <OnboardingHeading title={t("Statistics")} />
      <div className="onboarding-scroll">
        {/* The consent disclosure is its own section, read in full before the choice below it. */}
        <Surface
          as="section"
          variant="card"
          padding="md"
          aria-labelledby={disclosureTitle}
          data-stats-disclosure
        >
          <SectionLabel as="h3" labelId={disclosureTitle} className="onboarding-section-title">
            {t("What is sent")}
          </SectionLabel>
          <Text as="p" size="secondary" tone="secondary" leading="normal">
            {statsDisclosure()}
          </Text>
        </Surface>
        <div className="onboarding-actions">
          <SegmentedControl
            label={t("Statistics")}
            value={choice ?? ""}
            selectionRole="pressed"
            // Yes is the daily consent itself, so the signal is sent without a further review.
            onValueChange={(value) => setStatisticsMode(value === "on" ? "auto" : "off")}
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
