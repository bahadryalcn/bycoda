import { t, useLocale } from "../../../../../shared/i18n";
import { AppearanceSaveFeedback } from "../../useAppearanceSettings";
import { CrewStageCard } from "../controls/CrewStageCard";
import { WorkingIndicatorGroup } from "../controls/WorkingIndicatorGroup";

import { AppearanceSection } from "./AppearanceSection";
import { DesignStudioButton } from "../controls/DesignStudioButton";
import type { AppearanceSettings } from "../../useAppearanceSettings";
export function MotionSection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  return (
    <AppearanceSection id="motion" title={t("Motion and crew")}>
      <div className="flex justify-end">
        <DesignStudioButton
          appearance={appearance}
          kind="motion"
          label={t("Create motion preset")}
        />
      </div>
      <CrewStageCard />
      <WorkingIndicatorGroup />
      <AppearanceSaveFeedback settingIds={["working-indicator"]} />
    </AppearanceSection>
  );
}
