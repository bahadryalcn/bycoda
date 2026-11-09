import { t, useLocale } from "../../../../../shared/i18n";
import { AppearanceSaveFeedback } from "../../useAppearanceSettings";
import { CrewStageCard } from "../controls/CrewStageCard";
import { WorkingIndicatorGroup } from "../controls/WorkingIndicatorGroup";

import { AppearanceSection } from "./AppearanceSection";
export function MotionSection() {
  useLocale();
  return (
    <AppearanceSection id="motion" title={t("Motion and crew")}>
      <CrewStageCard />
      <WorkingIndicatorGroup />
      <AppearanceSaveFeedback settingIds={["working-indicator"]} />
    </AppearanceSection>
  );
}
